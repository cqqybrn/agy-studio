import React, { useMemo, useState } from 'react';
import type { Artifact } from '@agy-studio/contracts';
import { getArtifactRawUrl } from '../../api/endpoints';

export function isImageArtifact(artifact: Artifact): boolean {
  if (artifact.kind === 'image') return true;
  if (artifact.mimeType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(artifact.name);
}

export function isVideoArtifact(artifact: Artifact): boolean {
  if (artifact.kind === 'recording') return true;
  if (artifact.mimeType?.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|ogg|mkv)$/i.test(artifact.name);
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface MediaGalleryProps {
  artifacts: Artifact[];
  sessionId: string;
  highlightedArtifactId?: string | null;
  className?: string;
}

export function MediaGallery({
  artifacts = [],
  sessionId,
  highlightedArtifactId = null,
  className = '',
}: MediaGalleryProps) {
  const [previewImage, setPreviewImage] = useState<Artifact | null>(null);

  const images = useMemo(() => artifacts.filter(isImageArtifact), [artifacts]);
  const videos = useMemo(() => artifacts.filter(isVideoArtifact), [artifacts]);

  if (images.length === 0 && videos.length === 0) {
    return (
      <div
        className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border-default p-6 text-center text-text-tertiary"
        data-testid="media-empty-state"
      >
        <span className="text-sm">暂无多媒体产物</span>
        <span className="mt-1 text-xs text-text-tertiary">
          运行过程中生成的截图与录屏将在此集中展示
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-6 p-4 text-xs ${className}`} data-testid="media-gallery">
      {/* 图片网格展示 */}
      {images.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-text-secondary">{`图片产物 (${images.length})`}</h4>
            <span className="text-[11px] text-text-tertiary">点击可查看高清原图</span>
          </div>

          <div className="grid grid-cols-2 gap-3" data-testid="image-grid">
            {images.map((image) => {
              const url = getArtifactRawUrl(sessionId, image.id);
              const isHigh = highlightedArtifactId === image.id;
              return (
                <div
                  key={image.id}
                  onClick={() => setPreviewImage(image)}
                  className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-bg-surface transition-all duration-300 hover:border-accent hover:shadow-md ${
                    isHigh
                      ? 'border-status-warning ring-2 ring-status-warning/50'
                      : 'border-border-default'
                  }`}
                  data-testid={`image-card-${image.id}`}
                  data-highlighted={isHigh ? 'true' : 'false'}
                >
                  <div className="relative flex h-28 w-full items-center justify-center overflow-hidden bg-bg-panel">
                    <img
                      src={url}
                      alt={image.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span className="rounded bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                        点击放大
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col p-2">
                    <span className="truncate font-medium text-text-primary" title={image.name}>
                      {image.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      {formatFileSize(image.size)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 录屏与视频展示 */}
      {videos.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-text-secondary">{`录屏与视频 (${videos.length})`}</h4>
          </div>

          <div className="flex flex-col gap-4" data-testid="video-list">
            {videos.map((video) => {
              const url = getArtifactRawUrl(sessionId, video.id);
              const isHigh = highlightedArtifactId === video.id;
              return (
                <div
                  key={video.id}
                  className={`flex flex-col overflow-hidden rounded-lg border bg-bg-surface p-2.5 transition-all duration-300 ${
                    isHigh
                      ? 'border-status-warning ring-2 ring-status-warning/50'
                      : 'border-border-default'
                  }`}
                  data-testid={`video-card-${video.id}`}
                  data-highlighted={isHigh ? 'true' : 'false'}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="truncate font-medium text-text-primary" title={video.name}>
                      {video.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      {formatFileSize(video.size)}
                    </span>
                  </div>

                  <video
                    src={url}
                    controls
                    className="max-h-60 w-full rounded bg-black"
                    data-testid={`video-player-${video.id}`}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 大图预览弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
          data-testid="image-modal-overlay"
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center justify-center overflow-hidden rounded-lg border border-border-default bg-bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="image-modal-content"
          >
            {/* 顶栏控制 */}
            <div className="flex w-full items-center justify-between border-b border-border-default bg-bg-surface px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 truncate pr-4">
                <span className="font-semibold text-text-primary truncate">
                  {previewImage.name}
                </span>
                <span className="font-mono text-[11px] text-text-tertiary">
                  ({formatFileSize(previewImage.size)})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={getArtifactRawUrl(sessionId, previewImage.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary"
                  title="在新标签页中打开原图"
                >
                  新窗口打开 ↗
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary"
                  title="关闭 (Esc)"
                  data-testid="close-preview-btn"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 预览图片 */}
            <div className="flex max-h-[80vh] items-center justify-center overflow-auto p-2">
              <img
                src={getArtifactRawUrl(sessionId, previewImage.id)}
                alt={previewImage.name}
                className="max-h-[75vh] max-w-[85vw] rounded object-contain select-none shadow"
                data-testid="preview-expanded-image"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
