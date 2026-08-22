export function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return <span className="skeleton" style={{ width, height }} />;
}
