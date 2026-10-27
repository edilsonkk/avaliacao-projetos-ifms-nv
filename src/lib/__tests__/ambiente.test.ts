// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { lerConfiguracaoSupabase } from '@/lib/ambiente';

describe('lerConfiguracaoSupabase', () => {
  it('deve retornar a configuração quando URL e chave estão preenchidas', () => {
    // Arrange
    const env = {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'chave-anonima',
    };

    // Act
    const resultado = lerConfiguracaoSupabase(env);

    // Assert
    expect(resultado).toEqual({
      valida: true,
      url: 'http://127.0.0.1:54321',
      chaveAnonima: 'chave-anonima',
    });
  });

  it('deve listar todas as variáveis ausentes', () => {
    // Arrange / Act
    const resultado = lerConfiguracaoSupabase({});

    // Assert
    expect(resultado).toEqual({
      valida: false,
      problemas: [
        'VITE_SUPABASE_URL não está definida',
        'VITE_SUPABASE_ANON_KEY não está definida',
      ],
    });
  });

  it('deve tratar valores só com espaços como ausentes', () => {
    // Arrange / Act
    const resultado = lerConfiguracaoSupabase({
      VITE_SUPABASE_URL: '   ',
      VITE_SUPABASE_ANON_KEY: 'chave',
    });

    // Assert
    expect(resultado).toEqual({ valida: false, problemas: ['VITE_SUPABASE_URL não está definida'] });
  });

  it('deve rejeitar URL que não seja http(s)', () => {
    // Arrange / Act
    const resultado = lerConfiguracaoSupabase({
      VITE_SUPABASE_URL: 'siyenrhpejugoghlstqw.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'chave',
    });

    // Assert
    expect(resultado).toEqual({
      valida: false,
      problemas: ['VITE_SUPABASE_URL deve ser uma URL http(s) válida'],
    });
  });

  it('deve remover espaços e a barra final da URL', () => {
    // Arrange / Act
    const resultado = lerConfiguracaoSupabase({
      VITE_SUPABASE_URL: ' https://exemplo.supabase.co/ ',
      VITE_SUPABASE_ANON_KEY: ' chave ',
    });

    // Assert
    expect(resultado).toEqual({ valida: true, url: 'https://exemplo.supabase.co', chaveAnonima: 'chave' });
  });
});
