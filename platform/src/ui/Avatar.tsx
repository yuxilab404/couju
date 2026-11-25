const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#8e7dbe', '#f4a261', '#4c956c', '#d1495b'];

export function Avatar({ name, url, id, size = 36 }: { name: string; url: string | null; id: number | string; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.45 };
  if (url) return <img className="avatar" src={url} alt={name} style={style} />;
  const n = typeof id === 'number' ? id : [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className="avatar" style={{ ...style, background: COLORS[n % COLORS.length] }} aria-label={name}>
      {[...name][0] ?? '?'}
    </span>
  );
}
