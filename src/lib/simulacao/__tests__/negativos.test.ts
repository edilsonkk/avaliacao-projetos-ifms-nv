// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classificarFalha, resumirMensagem, NEGATIVOS_ESPERADOS } from '@/lib/simulacao/negativos';

/**
 * Mensagens COPIADAS LITERALMENTE de supabase/schema.sql (fn_enviar_avaliacao e
 * sortear_proximo_projeto). Se o banco mudar o texto, este teste cai — e é o ponto:
 * a classificação não pode calar em silêncio e passar a contar regra como erro.
 */
const MENSAGENS_DO_BANCO: readonly [string, string][] = [
  ['Cota de avaliações do projeto já atingida.', 'cota do projeto cheia'],
  ['Este avaliador já possui avaliação registrada para este projeto.', 'avaliador já avaliou este projeto'],
  ['Este projeto já é avaliado com outro questionário.', 'projeto fixado em outro questionário'],
  ['Este avaliador está vinculado a outro questionário neste evento.', 'avaliador vinculado a outro questionário'],
  ['Conflito de interesse: avaliador da mesma instituição do projeto.', 'conflito de interesse (mesma instituição)'],
  ['Modalidade do projeto bloqueada para este avaliador.', 'modalidade bloqueada para o avaliador'],
  ['Projeto sem check-in presencial.', 'projeto sem check-in'],
  ['Projeto fora da competição não pode ser avaliado.', 'projeto fora da competição'],
  ['Fora do horário de avaliação ou sistema pausado pela coordenação.', 'fora da janela de avaliação'],
  ['Sistema de avaliação bloqueado pela coordenação.', 'sistema pausado pela coordenação'],
  ['Sem trava ativa para este avaliador/projeto. Sorteie o projeto antes de avaliar.', 'trava vencida antes do envio'],
];

describe('classificarFalha', () => {
  it.each(MENSAGENS_DO_BANCO)('trata "%s" como regra', (mensagem, rotulo) => {
    // Act
    const falha = classificarFalha(mensagem);

    // Assert
    expect(falha).toEqual({ tipo: 'regra', rotulo });
  });

  it('trata mensagem desconhecida como erro, para não calar defeito novo', () => {
    // Act
    const falha = classificarFalha('column p.modalidade does not exist');

    // Assert
    expect(falha.tipo).toBe('erro');
    expect(falha.rotulo).toBe('column p.modalidade does not exist');
  });

  it('não confunde erro de permissão com recusa de regra', () => {
    // Arrange — 42501 do RLS não é a regra de negócio funcionando
    const falha = classificarFalha('new row violates row-level security policy for table "avaliacoes"');

    // Assert
    expect(falha.tipo).toBe('erro');
  });

  it('aceita mensagem vazia sem gerar rótulo vazio', () => {
    // Act / Assert
    expect(classificarFalha('').rotulo).toBe('erro sem mensagem');
  });

  it('todo negativo esperado tem rótulo legível em português', () => {
    // Assert
    expect(NEGATIVOS_ESPERADOS.length).toBeGreaterThan(5);
    expect(NEGATIVOS_ESPERADOS.every((n) => n.rotulo.length > 3)).toBe(true);
  });
});

describe('resumirMensagem', () => {
  it('corta a mensagem longa e guarda só a primeira linha', () => {
    // Act
    const resumo = resumirMensagem(`${'x'.repeat(300)}\nsegunda linha`);

    // Assert
    expect(resumo.length).toBeLessThanOrEqual(121);
    expect(resumo).not.toContain('segunda linha');
  });
});
