import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TelaAvaliador } from '@/features/avaliacao';
import { AtribuicaoForcada } from '@/features/atribuicoes';
import { supabase } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  isSupabaseConfigured: () => true,
  verificar_conexao_configurada: () => true,
}));

describe('Auditoria de Regressão: Impedir Reatribuição do Mesmo Projeto ao Mesmo Avaliador após Soft Delete', () => {
  const eventoId = 'e0000000-0000-0000-0000-000000000001';
  const usuarioAvaliadorId = 'u0000000-0000-0000-0000-000000000001';
  const outroAvaliadorId = 'u0000000-0000-0000-0000-000000000002';
  const projetoId = 'p0000000-0000-0000-0000-000000000001';

  let chamadasDeleteLocks: any[] = [];
  let chamadasRpcSorteio: any[] = [];

  const criarQueryChain = (resultadoFinal: any) => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(resultadoFinal),
      single: vi.fn().mockResolvedValue(resultadoFinal),
      delete: vi.fn().mockImplementation(() => {
        return {
          eq: vi.fn().mockImplementation((col, val) => {
            chamadasDeleteLocks.push({ col, val });
            return Promise.resolve({ error: null });
          }),
        };
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resultadoFinal).then(resolve),
    };
    return chain;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasDeleteLocks = [];
    chamadasRpcSorteio = [];
    localStorage.clear();
    localStorage.setItem('evento_ativo_id', eventoId);
    localStorage.setItem('sessao_id_usuario', usuarioAvaliadorId);

    vi.mocked(supabase.rpc).mockImplementation((nomeFn: string, params: any) => {
      chamadasRpcSorteio.push({ nomeFn, params });
      return Promise.resolve({ data: null, error: null }) as any;
    });
  });

  it('deve validar no schema.sql e na migration que o sorteio bloqueia incondicionalmente projetos avaliados pelo mesmo avaliador', () => {
    const raizProjeto = path.resolve(__dirname, '../../..');
    const schemaSql = fs.readFileSync(path.resolve(raizProjeto, 'supabase/schema.sql'), 'utf-8');
    const migrationSql = fs.readFileSync(
      path.resolve(raizProjeto, 'supabase/migrations/20261025030000_sorteio_impedir_mesmo_avaliador_soft_delete.sql'),
      'utf-8'
    );

    // 1. Na migration e schema, o NOT IN por avaliador não deve conter filtro por 'CANCELADA'
    expect(migrationSql).toContain('p.id_projeto NOT IN (');
    expect(migrationSql).toContain('SELECT a.id_projeto FROM public.avaliacoes a \n      WHERE a.id_usuario = p_id_usuario');
    expect(migrationSql).not.toContain("WHERE a.id_usuario = p_id_usuario \n        AND (a.status IS NULL OR a.status != 'CANCELADA')");

    // No schema gerado a indentação acompanha a versão atual da função: compara ignorando espaços
    const schemaCompacto = schemaSql.replace(/\s+/g, ' ');
    expect(schemaCompacto).toContain('p.id_projeto NOT IN (');
    expect(schemaCompacto).toContain('SELECT a.id_projeto FROM public.avaliacoes a WHERE a.id_usuario = p_id_usuario )');
    expect(schemaCompacto).not.toContain("WHERE a.id_usuario = p_id_usuario AND (a.status IS NULL OR a.status != 'CANCELADA')");

    // 2. A cota do projeto continua ignorando avaliações CANCELADA para abrir vaga a outros avaliadores
    expect(migrationSql).toContain("(a.status IS NULL OR a.status != 'CANCELADA')");
    expect(schemaSql).toContain("(a.status IS NULL OR a.status != 'CANCELADA')");

    // 3. Garante constraint única 'unica_avaliacao_por_usuario'
    expect(migrationSql).toContain('unica_avaliacao_por_usuario');
    expect(schemaSql).toContain('unica_avaliacao_por_usuario');
  });

  it('TelaAvaliador: deve expurgar lock ativo e disparar novo sorteio se o avaliador já possuir registro em avaliacoes para aquele projeto', async () => {
    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: {
            id_evento: eventoId,
            nome_evento: 'FETEC 2026',
            data_evento: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`,
            horario_inicio: '00:00',
            horario_fim: '23:59',
            sistema_liberado: true,
            is_ativo: true,
          },
          error: null,
        });
      }
      if (tabela === 'locks_ativos') {
        return criarQueryChain({
          data: { id_projeto: projetoId },
          error: null,
        });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: {
            id_projeto: projetoId,
            codigo_projeto: 'AGRO-001',
            titulo: 'Projeto com Soft Delete',
            id_modalidade: null,
          },
          error: null,
        });
      }
      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({ data: [], error: null });
      }
      if (tabela === 'avaliacoes') {
        // Simula que já existe uma avaliação registrada (mesmo que com soft delete) para este par (projeto, avaliador)
        return criarQueryChain({
          data: { id_avaliacao: 'aval-cancelada-001' },
          error: null,
        });
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(
      <TelaAvaliador
        id_usuario_logado={usuarioAvaliadorId}
        id_evento_ativo={eventoId}
      />
    );

    await waitFor(() => {
      // O lock ativo é descartado no banco (fn_assumir_item_fila e o sorteio apagam a trava anterior do avaliador)
      // e um novo sorteio limpo é acionado em seguida
      const nomes = chamadasRpcSorteio.map((c) => c.nomeFn);
      expect(nomes.indexOf('fn_assumir_item_fila')).toBeGreaterThanOrEqual(0);
      expect(nomes.indexOf('sortear_proximo_projeto')).toBeGreaterThan(nomes.indexOf('fn_assumir_item_fila'));
    });
  });

  it('AtribuicaoForcada: não deve contar avaliação cancelada na cota do projeto, mas deve marcar o avaliador original como inelegível', async () => {
    vi.mocked(supabase.from).mockImplementation((tabela: string) => {
      if (tabela === 'eventos') {
        return criarQueryChain({
          data: { id_evento: eventoId, nome: 'FETEC 2026', cota_avaliacoes_padrao: 3 },
          error: null,
        });
      }
      if (tabela === 'projetos') {
        return criarQueryChain({
          data: [
            {
              id_projeto: projetoId,
              id_evento: eventoId,
              codigo_projeto: 'PROJ-001',
              titulo: 'Projeto com Avaliacao Cancelada',
              is_check_in_realizado: true,
              is_fora_da_competicao: false,
              cota_avaliacoes_customizada: 3,
            },
          ],
          error: null,
        });
      }
      if (tabela === 'view_avaliadores_credenciados') {
        return criarQueryChain({
          data: [
            { id_usuario: usuarioAvaliadorId, nome: 'Avaliador Original', email: 'original@ifms.edu.br', is_credenciado: true },
            { id_usuario: outroAvaliadorId, nome: 'Outro Avaliador', email: 'outro@ifms.edu.br', is_credenciado: true },
          ],
          error: null,
        });
      }
      if (tabela === 'avaliadores_evento') {
        return criarQueryChain({
          data: [
            { id_usuario: usuarioAvaliadorId, id_instituicao: null, is_credenciado: true, usuarios: { nome: 'Avaliador Original', email: 'original@ifms.edu.br', papel: 'AVALIADOR' } },
            { id_usuario: outroAvaliadorId, id_instituicao: null, is_credenciado: true, usuarios: { nome: 'Outro Avaliador', email: 'outro@ifms.edu.br', papel: 'AVALIADOR' } },
          ],
          error: null,
        });
      }
      if (tabela === 'locks_ativos') {
        return criarQueryChain({ data: [], error: null });
      }
      if (tabela === 'avaliador_modalidades_bloqueadas') {
        return criarQueryChain({ data: [], error: null });
      }
      if (tabela === 'avaliacoes') {
        // Retorna a avaliação cancelada do Avaliador Original
        return criarQueryChain({
          data: [
            {
              id_projeto: projetoId,
              id_usuario: usuarioAvaliadorId,
              status: 'CANCELADA',
              status_avaliacao: 'CANCELADA',
              is_quarentena: false,
            },
          ],
          error: null,
        });
      }
      return criarQueryChain({ data: [], error: null });
    });

    render(
      <AtribuicaoForcada
        isOpen={true}
        aoFechar={vi.fn()}
        id_evento_ativo={eventoId}
      />
    );

    // O projeto deve ser listado como elegível pois a avaliação cancelada não ocupa cota
    await waitFor(() => {
      expect(screen.getByText('Projeto com Avaliacao Cancelada')).toBeInTheDocument();
    });

    // Clica no projeto para abrir a lista de avaliadores para a banca
    fireEvent.click(screen.getByText('Projeto com Avaliacao Cancelada'));

    // O avaliador original deve ser marcado com 'Já avaliou este projeto'
    await waitFor(() => {
      expect(screen.getByText('Já avaliou este projeto')).toBeInTheDocument();
    });
  });
});
