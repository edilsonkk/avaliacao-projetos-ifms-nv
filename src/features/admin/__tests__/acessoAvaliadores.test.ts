// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  PARAMETROS_ACESSO_PADRAO,
  lerParametrosAcesso,
  validarParametrosAcesso,
} from '@/features/admin/acessoAvaliadores';

describe('parâmetros de acesso dos avaliadores', () => {
  it('deve usar os padrões quando o evento ainda não tem os campos', () => {
    // Act / Assert
    expect(lerParametrosAcesso({})).toEqual(PARAMETROS_ACESSO_PADRAO);
    expect(PARAMETROS_ACESSO_PADRAO).toEqual({
      minutos_validade_pareamento: 10,
      minutos_validade_codigo_acesso: 15,
      tamanho_codigo: 6,
      max_tentativas_codigo: 5,
      metodos_vinculo: 'ambos',
    });
  });

  it('deve ler os valores gravados no evento', () => {
    // Act
    const lidos = lerParametrosAcesso({
      minutos_validade_pareamento: 5,
      minutos_validade_codigo_acesso: 30,
      tamanho_codigo: 8,
      max_tentativas_codigo: 3,
      metodos_vinculo: 'pareamento',
    });

    // Assert
    expect(lidos).toEqual({
      minutos_validade_pareamento: 5,
      minutos_validade_codigo_acesso: 30,
      tamanho_codigo: 8,
      max_tentativas_codigo: 3,
      metodos_vinculo: 'pareamento',
    });
  });

  it('deve aceitar os padrões', () => {
    expect(validarParametrosAcesso(PARAMETROS_ACESSO_PADRAO)).toEqual([]);
  });

  it('deve recusar valores fora dos limites do banco', () => {
    // Act
    const erros = validarParametrosAcesso({
      minutos_validade_pareamento: 0,
      minutos_validade_codigo_acesso: 121,
      tamanho_codigo: 5,
      max_tentativas_codigo: 11,
      metodos_vinculo: 'ambos',
    });

    // Assert
    expect(erros).toEqual([
      'Validade do código de pareamento deve ficar entre 1 e 60 minutos.',
      'Validade do código de acesso deve ficar entre 1 e 120 minutos.',
      'Tamanho dos códigos deve ficar entre 6 e 10 caracteres.',
      'Tentativas por código de acesso deve ficar entre 1 e 10.',
    ]);
  });

  it('deve recusar número não inteiro', () => {
    expect(validarParametrosAcesso({ ...PARAMETROS_ACESSO_PADRAO, tamanho_codigo: 6.5 })).toEqual([
      'Tamanho dos códigos deve ficar entre 6 e 10 caracteres.',
    ]);
  });
});
