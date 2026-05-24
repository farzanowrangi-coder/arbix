import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-terminal grid-bg flex flex-col items-center justify-center px-4">
      <Link href="/" className="mb-8 text-green-arb font-bold text-xl glow-green-sm tracking-widest">
        ARBIX
      </Link>
      {children}
    </div>
  );
}
