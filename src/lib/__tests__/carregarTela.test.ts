// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { carregarComRetentativa, carregarTela } from '@/lib/carregarTela';

/**
 * Com as telas divididas em pedaços, a busca do pedaço acontece quando a pessoa troca de tela — na
 * rede do ginásio, é onde ela falha. O `React.lazy` guarda a primeira resposta, inclusive a falha,
 * então a retentativa precisa acontecer antes dele.
 */

/** Espera instantânea: o teste não depende de timer real (regra de performance do TESTES_TDD). */
const semEspera = () => Promise.resolve();

describe('carregarComRetentativa', () => {
  it('deve devolver o módulo na primeira tentativa, sem esperar', async () => {
    // Arrange
    const carregar = vi.fn().mockResolvedValue({ TelaAdmin: 'modulo' });
    const aguardar = vi.fn(semEspera);

    // Act
    const modulo = await carregarComRetentativa(carregar, { aguardar });

    // Assert
    expect(modulo).toEqual({ TelaAdmin: 'modulo' });
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(aguardar).not.toHaveBeenCalled();
  });

  it('deve insistir quando a rede cai no meio e entregar o módulo depois', async () => {
    // Arrange: falha uma vez, como uma oscilação de 4G
    const carregar = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValue({ TelaAdmin: 'modulo' });

    // Act
    const modulo = await carregarComRetentativa(carregar, { aguardar: semEspera });

    // Assert
    expect(modulo).toEqual({ TelaAdmin: 'modulo' });
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it('deve esperar mais a cada falha, em vez de martelar a rede', async () => {
    // Arrange
    const esperas: number[] = [];
    const carregar = vi
      .fn()
      .mockRejectedValueOnce(new Error('queda 1'))
      .mockRejectedValueOnce(new Error('queda 2'))
      .mockResolvedValue({ TelaAdmin: 'modulo' });

    // Act
    await carregarComRetentativa(carregar, {
      esperaInicialMs: 100,
      aguardar: (ms) => {
        esperas.push(ms);
        return Promise.resolve();
      },
    });

    // Assert
    expect(esperas).toEqual([100, 200]);
  });

  it('deve desistir com o erro da última tentativa quando a rede não volta', async () => {
    // Arrange
    const carregar = vi.fn().mockRejectedValue(new Error('sem internet'));

    // Act / Assert
    await expect(carregarComRetentativa(carregar, { tentativas: 3, aguardar: semEspera })).rejects.toThrow(
      'sem internet',
    );
    expect(carregar).toHaveBeenCalledTimes(3);
  });

  it('não deve tentar mais de uma vez quando o chamador pede uma só', async () => {
    // Arrange
    const carregar = vi.fn().mockRejectedValue(new Error('falhou'));

    // Act / Assert
    await expect(carregarComRetentativa(carregar, { tentativas: 1, aguardar: semEspera })).rejects.toThrow('falhou');
    expect(carregar).toHaveBeenCalledTimes(1);
  });
});

describe('carregarTela', () => {
  it('deve entregar a tela no formato que o React.lazy espera', async () => {
    // Arrange
    const TelaFalsa = () => null;

    // Act
    const resultado = await carregarTela(async () => ({ TelaAdmin: TelaFalsa }), 'TelaAdmin');

    // Assert
    expect(resultado).toEqual({ default: TelaFalsa });
  });
});
