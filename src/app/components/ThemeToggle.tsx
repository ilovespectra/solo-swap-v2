'use client';

import { useTheme } from '../contexts/themeContext';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle-btn p-2.5 transition-all duration-300 hover:scale-110 active:scale-95"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{ touchAction: 'manipulation' }}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-orange-primary" />
      ) : (
        <Moon className="h-5 w-5 text-orange-primary" />
      )}
    </button>
  );
}
