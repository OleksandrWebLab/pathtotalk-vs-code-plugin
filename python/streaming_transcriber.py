"""
Streaming transcription with LocalAgreement.

Holds a rolling audio buffer; on each process_iter() call transcribes the whole
buffer with word-level timestamps, then commits a stable prefix by matching
against the previous iteration's tail (two consecutive runs agreeing on the
same words). Committed words are trimmed from the buffer so processing stays
bounded as the recording grows.
"""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from loguru import logger


SAMPLE_RATE = 16000
MIN_SECONDS_TO_PROCESS = 1.0
MAX_BUFFER_SECONDS = 30.0
CONTEXT_PROMPT_CHARS = 200


@dataclass
class Word:
    start: float
    end: float
    text: str


@dataclass
class StreamingResult:
    confirmed_text: str
    pending_text: str
    newly_committed: str = ""
    duration_sec: float = 0.0


@dataclass
class StreamingTranscriber:
    whisper: object
    language: Optional[str]
    buffer: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    confirmed_text: str = ""
    previous_tail: list[Word] = field(default_factory=list)
    buffer_time_offset: float = 0.0

    def insert_audio_chunk(self, pcm_bytes: bytes) -> None:
        """Append raw little-endian 16-bit mono PCM bytes to the buffer."""
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buffer = np.concatenate([self.buffer, samples])

    @property
    def buffered_seconds(self) -> float:
        return len(self.buffer) / SAMPLE_RATE

    @property
    def total_seconds(self) -> float:
        return self.buffer_time_offset + self.buffered_seconds

    def process_iter(self) -> StreamingResult:
        if self.buffered_seconds < MIN_SECONDS_TO_PROCESS:
            return StreamingResult(
                confirmed_text=self.confirmed_text,
                pending_text=self._words_to_text(self.previous_tail),
                duration_sec=self.total_seconds,
            )

        prompt = self.confirmed_text[-CONTEXT_PROMPT_CHARS:] if self.confirmed_text else None
        segments, _info = self.whisper.transcribe_samples_with_words(
            self.buffer,
            self.language,
            initial_prompt=prompt,
        )

        current_words: list[Word] = []
        for segment in segments:
            if not segment.words:
                continue
            for word in segment.words:
                current_words.append(Word(
                    start=float(word.start) + self.buffer_time_offset,
                    end=float(word.end) + self.buffer_time_offset,
                    text=word.word,
                ))

        common_prefix = self._longest_common_prefix(current_words, self.previous_tail)

        newly_committed = ""
        if common_prefix:
            newly_committed = self._words_to_text(common_prefix)
            self.confirmed_text += newly_committed
            last_end_rel = common_prefix[-1].end - self.buffer_time_offset
            samples_to_drop = int(last_end_rel * SAMPLE_RATE)
            samples_to_drop = max(0, min(samples_to_drop, len(self.buffer)))
            self.buffer = self.buffer[samples_to_drop:]
            self.buffer_time_offset += last_end_rel
            self.previous_tail = current_words[len(common_prefix):]
        else:
            self.previous_tail = current_words

        if self.buffered_seconds > MAX_BUFFER_SECONDS:
            overflow_sec = self.buffered_seconds - MAX_BUFFER_SECONDS
            samples_to_drop = int(overflow_sec * SAMPLE_RATE)
            self.buffer = self.buffer[samples_to_drop:]
            self.buffer_time_offset += overflow_sec
            logger.warning("Streaming buffer exceeded {}s, dropped {:.1f}s", MAX_BUFFER_SECONDS, overflow_sec)

        return StreamingResult(
            confirmed_text=self.confirmed_text,
            pending_text=self._words_to_text(self.previous_tail),
            newly_committed=newly_committed,
            duration_sec=self.total_seconds,
        )

    def finalize(self) -> StreamingResult:
        """Flush remaining buffer into confirmed text."""
        if self.buffered_seconds >= MIN_SECONDS_TO_PROCESS:
            prompt = self.confirmed_text[-CONTEXT_PROMPT_CHARS:] if self.confirmed_text else None
            segments, _info = self.whisper.transcribe_samples_with_words(
                self.buffer,
                self.language,
                initial_prompt=prompt,
            )
            tail_text = ""
            for segment in segments:
                tail_text += segment.text
            self.confirmed_text += tail_text
        elif self.previous_tail:
            self.confirmed_text += self._words_to_text(self.previous_tail)

        self.buffer = np.zeros(0, dtype=np.float32)
        self.previous_tail = []

        return StreamingResult(
            confirmed_text=self.confirmed_text,
            pending_text="",
            duration_sec=self.total_seconds,
        )

    @staticmethod
    def _longest_common_prefix(current: list[Word], previous: list[Word]) -> list[Word]:
        result: list[Word] = []
        for a, b in zip(current, previous):
            if a.text.strip().lower() == b.text.strip().lower():
                result.append(a)
            else:
                break
        return result

    @staticmethod
    def _words_to_text(words: list[Word]) -> str:
        return "".join(word.text for word in words)
