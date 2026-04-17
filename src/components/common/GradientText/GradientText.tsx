import type { ReactNode } from 'react';
import styles from './GradientText.module.css';

interface GradientTextProps {
  children: ReactNode;
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'div';
  className?: string;
}

export function GradientText({
  children,
  as: Tag = 'span',
  className,
}: GradientTextProps) {
  return (
    <Tag className={`${styles.gradient} ${className ?? ''}`}>
      {children}
    </Tag>
  );
}
