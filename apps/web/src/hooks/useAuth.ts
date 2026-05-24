'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store';
import { authApi } from '@/lib/api';
import { clearTokens } from '@/lib/auth';

export function useAuth() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, login: storeLogin, logout: storeLogout, setLoading } = useAuthStore();

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const res = await authApi.login(email, password);
        if (!res.success || !res.data) throw new Error(res.error ?? 'Login failed');
        storeLogin(res.data.user, res.data.tokens);
        router.push('/dashboard');
        toast.success('Welcome back!');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Login failed';
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [router, storeLogin, setLoading],
  );

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      setLoading(true);
      try {
        const res = await authApi.register(email, username, password);
        if (!res.success || !res.data) throw new Error(res.error ?? 'Registration failed');
        storeLogin(res.data.user, res.data.tokens);
        router.push('/dashboard');
        toast.success('Account created!');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Registration failed';
        toast.error(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [router, storeLogin, setLoading],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      clearTokens();
    }
    storeLogout();
    router.push('/login');
    toast.success('Logged out');
  }, [router, storeLogout]);

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    register,
    logout,
  };
}
