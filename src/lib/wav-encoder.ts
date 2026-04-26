const SAMPLE_RATE_HZ = 16000;
const CHANNEL_COUNT = 1;
const BITS_PER_SAMPLE = 16;
const HEADER_SIZE_BYTES = 44;

export function encodePcmToWav(pcmChunks: Buffer[]): Buffer {
    const pcmData = Buffer.concat(pcmChunks);
    const byteRate = (SAMPLE_RATE_HZ * CHANNEL_COUNT * BITS_PER_SAMPLE) / 8;
    const blockAlign = (CHANNEL_COUNT * BITS_PER_SAMPLE) / 8;
    const dataSize = pcmData.length;
    const chunkSize = HEADER_SIZE_BYTES - 8 + dataSize;

    const header = Buffer.alloc(HEADER_SIZE_BYTES);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(chunkSize, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNEL_COUNT, 22);
    header.writeUInt32LE(SAMPLE_RATE_HZ, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
}
