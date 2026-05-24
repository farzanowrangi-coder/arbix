'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store';
import { api } from '@/lib/api';
import { storeTokens } from '@/lib/auth';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.login);
  const [form, setForm] = useState({ email: '', username: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        email: form.email,
        username: form.username,
        password: form.password,
      });
      const { user, tokens } = res.data.data;
      storeTokens(tokens);
      setAuth(user, tokens);
      toast.success('Account created — welcome to ArbiX');
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm"
    >
      <div className="border border-border bg-card rounded-lg p-8">
        <h1 className="text-lg font-bold text-text-primary mb-1">Create Account</h1>
        <p className="text-text-muted text-xs mb-6">Start scanning for arbitrage opportunities</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { key: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
            { key: 'username', label: 'Username', type: 'text', placeholder: 'arb_trader' },
            { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
            { key: 'confirm', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
          ].map(({ key, label, type, placeholder }) => (
            <div key={key}>
              <label className="block text-xs text-text-secondary mb-1.5">{label}</label>
              <input
                type={type}
                value={(form as any)[key]}
                onChange={set(key)}
                required
                className="w-full bg-terminal border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-green-arb/50 transition-colors"
                placeholder={placeholder}
              />
            </div>
          ))}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-green-arb text-terminal font-bold text-sm rounded hover:bg-green-arb-dim transition-colors disabled:opacity-50 shadow-neon-green"
          >
            {loading ? 'Creating account...' : 'Create Free Account'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-text-muted">
          Already have an account?{' '}
          <Link href="/login" className="text-green-arb hover:text-green-arb-dim transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </motion.div>
  );
}
