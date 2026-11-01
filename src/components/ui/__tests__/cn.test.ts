import { describe, it, expect } from 'vitest';
import { cn } from '@/components/ui';

describe('cn', () => {
  it('deve juntar as classes verdadeiras e descartar as condições falsas', () => {
    // Arrange
    const ativo = false;
    const largo = true;

    // Act
    const classes = cn('base', ativo && 'ativo', largo && 'largo', undefined, null, '');

    // Assert
    expect(classes).toBe('base largo');
  });
});
