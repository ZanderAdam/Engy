import { describe, it, expect, vi } from 'vitest';
import { getBranchInfo, getStatus } from './index.js';

vi.mock('simple-git', () => {
  const mockStatus = vi.fn();
  return {
    simpleGit: vi.fn(() => ({
      status: mockStatus,
    })),
    _mockStatus: mockStatus,
  };
});

async function getMockStatus() {
  const mod = await import('simple-git');
  return (mod as unknown as { _mockStatus: ReturnType<typeof vi.fn> })._mockStatus;
}

describe('getBranchInfo', () => {
  it('returns branch name and detached state', async () => {
    const mockStatus = await getMockStatus();
    mockStatus.mockResolvedValue({
      current: 'main',
      detached: false,
    });

    const info = await getBranchInfo('/tmp/repo');
    expect(info).toEqual({ current: 'main', isDetached: false });
  });

  it('returns HEAD when current is null (detached)', async () => {
    const mockStatus = await getMockStatus();
    mockStatus.mockResolvedValue({
      current: null,
      detached: true,
    });

    const info = await getBranchInfo('/tmp/repo');
    expect(info).toEqual({ current: 'HEAD', isDetached: true });
  });
});

describe('getStatus', () => {
  it('returns file paths and statuses', async () => {
    const mockStatus = await getMockStatus();
    mockStatus.mockResolvedValue({
      files: [
        { path: 'src/index.ts', working_dir: 'M', index: ' ' },
        { path: 'README.md', working_dir: ' ', index: 'A' },
      ],
    });

    const result = await getStatus('/tmp/repo');
    expect(result).toEqual([
      { path: 'src/index.ts', status: 'M' },
      { path: 'README.md', status: 'A' },
    ]);
  });

  it('returns empty array for clean repo', async () => {
    const mockStatus = await getMockStatus();
    mockStatus.mockResolvedValue({ files: [] });

    const result = await getStatus('/tmp/repo');
    expect(result).toEqual([]);
  });
});
