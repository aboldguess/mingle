import { Link } from 'react-router-dom';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Mingle home">
      <span className="logo-mark" aria-hidden />
      Mingle
    </Link>
  );
}
