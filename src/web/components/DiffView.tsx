import { parsePatchFiles } from '@pierre/diffs';
import { MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DiffFile, DiffLine, ReviewRecord, Side } from '../../shared/types';
import { useReviewStore } from '../store';
import { CommentPopover } from './CommentPopover';
import { FileHeader } from './FileHeader';

interface RowRef {
  filePath: string;
  side: Side;
  line: number;
  snippet: string;
}

export function DiffView({ record }: { record: ReviewRecord }) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const pierreFiles = useMemo(() => {
    try {
      return parsePatchFiles(record.diff.rawDiff, record.meta.id).flatMap((patch) => patch.files)
        .length;
    } catch {
      return 0;
    }
  }, [record.diff.rawDiff, record.meta.id]);

  return (
    <section className="diff-stack" data-pierre-files={pierreFiles}>
      {record.diff.files.length === 0 ? (
        <div className="empty-diff">No local changes found.</div>
      ) : (
        record.diff.files.map((file) => {
          const collapsed = collapsedFiles.has(file.path);
          return (
            <article className="file-card" key={`${file.oldPath ?? file.path}:${file.path}`}>
              <FileHeader
                file={file}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedFiles((current) => {
                    const next = new Set(current);
                    next.has(file.path) ? next.delete(file.path) : next.add(file.path);
                    return next;
                  })
                }
              />
              {collapsed ? null : <DiffFileTable file={file} />}
            </article>
          );
        })
      )}
      <CommentPopover />
    </section>
  );
}

function DiffFileTable({ file }: { file: DiffFile }) {
  const comments = useReviewStore((state) => state.comments);
  const setDraft = useReviewStore((state) => state.setDraft);
  const [dragStart, setDragStart] = useState<RowRef | null>(null);
  const [dragEnd, setDragEnd] = useState<RowRef | null>(null);
  let previousNewEnd = 0;

  const fileComments = comments.filter((comment) => comment.filePath === file.path);

  const openDraft = (row: RowRef, event: React.MouseEvent, end = row) => {
    const startLine = Math.min(row.line, end.line);
    const endLine = Math.max(row.line, end.line);
    const snippet = collectSnippet(file, row.side, startLine, endLine) || row.snippet;
    setDraft({
      filePath: file.path,
      side: row.side,
      startLine,
      endLine,
      originalSnippet: snippet,
      anchor: {
        x: Math.min(event.clientX + 12, window.innerWidth - 380),
        y: Math.max(80, event.clientY - 12)
      }
    });
  };

  return (
    <fieldset className="diff-table" onMouseLeave={() => setDragEnd(null)}>
      <legend className="sr-only">{file.path} diff</legend>
      {file.isBinary ? <div className="binary-note">Binary file changed</div> : null}
      {file.hunks.map((hunk) => {
        const hidden = hunk.newStart > previousNewEnd + 1 ? hunk.newStart - previousNewEnd - 1 : 0;
        previousNewEnd = hunk.newStart + hunk.newLines - 1;
        return (
          <div className="hunk" key={`${hunk.oldStart}:${hunk.newStart}`}>
            {hidden > 0 ? (
              <button className="hidden-lines" type="button">
                {hidden} unmodified lines
              </button>
            ) : null}
            <div className="hunk-header">
              {hunk.header ||
                `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
            </div>
            {hunk.lines.map((line) => {
              const side = sideForLine(line);
              const lineNumber = side === 'L' ? line.oldLine : line.newLine;
              if (lineNumber == null) {
                return null;
              }
              const row: RowRef = {
                filePath: file.path,
                side,
                line: lineNumber,
                snippet: line.content
              };
              const selected =
                dragStart &&
                dragEnd &&
                dragStart.filePath === file.path &&
                dragStart.side === side &&
                lineNumber >= Math.min(dragStart.line, dragEnd.line) &&
                lineNumber <= Math.max(dragStart.line, dragEnd.line);
              const rowComments = fileComments.filter(
                (comment) =>
                  comment.side === side &&
                  lineNumber >= comment.startLine &&
                  lineNumber <= comment.endLine
              );
              return (
                <div
                  key={`${line.type}:${line.oldLine ?? 'x'}:${line.newLine ?? 'x'}:${line.content}`}
                >
                  <button
                    className={`diff-row ${line.type} ${selected ? 'selected' : ''}`}
                    type="button"
                    onMouseDown={(event) => {
                      setDragStart(row);
                      setDragEnd(row);
                      if (event.detail === 1) {
                        event.preventDefault();
                      }
                    }}
                    onMouseEnter={() => {
                      if (dragStart?.filePath === file.path && dragStart.side === side) {
                        setDragEnd(row);
                      }
                    }}
                    onMouseUp={(event) => {
                      if (
                        dragStart &&
                        dragStart.filePath === file.path &&
                        dragStart.side === side &&
                        dragEnd
                      ) {
                        openDraft(dragStart, event, row);
                      } else {
                        openDraft(row, event);
                      }
                      setDragStart(null);
                      setDragEnd(null);
                    }}
                  >
                    <span className="line-number old">{line.oldLine ?? ''}</span>
                    <span className="line-number new">{line.newLine ?? ''}</span>
                    <span className="marker">{markerForLine(line)}</span>
                    <code>{line.content || ' '}</code>
                  </button>
                  {rowComments.map((comment) => (
                    <div className="inline-comment" key={comment.id}>
                      <MessageSquare size={14} />
                      <span>{comment.body}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </fieldset>
  );
}

function markerForLine(line: DiffLine): string {
  if (line.type === 'add') {
    return '+';
  }
  if (line.type === 'delete') {
    return '-';
  }
  return ' ';
}

function sideForLine(line: DiffLine): Side {
  return line.type === 'delete' ? 'L' : 'R';
}

function collectSnippet(file: DiffFile, side: Side, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const lineNumber = side === 'L' ? line.oldLine : line.newLine;
      const lineSide = sideForLine(line);
      if (
        lineSide === side &&
        lineNumber != null &&
        lineNumber >= startLine &&
        lineNumber <= endLine
      ) {
        lines.push(line.content);
      }
    }
  }
  return lines.join('\n');
}
