import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GestorProjetos } from '@/features/projetos';
import { CHAVE_NATURAL_PROJETOS } from '@/features/projetos/components/GestorProjetos';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
  verificar_conexao_configurada: vi.fn(() => true),
}));

const ID_EVENTO = 'evt-1';
const UUID_PROJETO = 'e8b8c1d2-9999-4a1b-8c2d-9876543210ab';

const projeto = (extra: Record<string, unknown> = {}) => ({
  id_projeto: UUID_PROJETO,
  codigo_projeto: 'FETEC-001',
  titulo: 'Desenvolvimento Sustentável',
  estande: 'EST-A01',
  corredor: 'A',
  is_check_in_realizado: false,
  id_evento: ID_EVENTO,
  id_instituicao: 'inst-1',
  id_area: 'area-1',
  id_modalidade: 'mod-1',
  is_fora_da_competicao: false,
  forcar_topo_fila: false,
  instituicoes: { id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campus Campo Grande', sigla: 'IFMS-CG' },
  areas_tematicas: { id_area: 'area-1', nome_area: 'Ciências Exatas' },
  modalidades: { id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio' },
  ...extra,
});

type Chamada = { tabela: string; metodo: string; args: unknown[] };
let chamadas: Chamada[] = [];
let dados: Record<string, unknown[]> = {};
let erros: Record<string, { code?: string; message: string } | null> = {};

/** Cadeia do supabase-js simulada por tabela; registra cada método chamado. */
const mockarBanco = () => {
  vi.mocked(supabase.from).mockImplementation(((tabela: string) => {
    let escrita: string | null = null;
    const chain: any = {};
    ['select', 'eq', 'is', 'order', 'insert', 'upsert', 'update', 'delete', 'neq', 'single'].forEach((metodo) => {
      chain[metodo] = vi.fn((...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        if (['insert', 'upsert', 'update', 'delete'].includes(metodo)) escrita = metodo;
        return chain;
      });
    });
    chain.then = (resolve: any, reject: any) => {
      const erro = escrita ? erros[`${tabela}.${escrita}`] ?? null : null;
      let resultado: unknown = dados[tabela] ?? [];
      if (escrita === 'insert' && !erro) {
        const ultimo = [...chamadas].reverse().find((c) => c.tabela === tabela && c.metodo === 'insert');
        resultado = (ultimo?.args[0] as any[]).map((linha, i) => ({ ...linha, [`id_${tabela === 'areas_tematicas' ? 'area' : tabela === 'instituicoes' ? 'instituicao' : 'modalidade'}`]: `${tabela}-novo-${i}` }));
      }
      return Promise.resolve({ data: erro ? null : resultado, error: erro }).then(resolve, reject);
    };
    return chain;
  }) as never);
};

const chamadasDe = (tabela: string, metodo: string) => chamadas.filter((c) => c.tabela === tabela && c.metodo === metodo);

const enviarPlanilha = async (user: ReturnType<typeof userEvent.setup>, csv: string) => {
  const arquivo = new File([csv], 'projetos.csv', { type: 'text/csv' });
  const input = document.getElementById('input-planilha-projetos') as HTMLInputElement;
  await user.upload(input, arquivo);
};

const CABECALHO = 'codigo_projeto,titulo,estande,corredor,instituicao,sigla_instituicao,area_tematica,modalidade,fora_da_competicao';

describe('GestorProjetos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    chamadas = [];
    erros = {};
    dados = {
      projetos: [projeto()],
      instituicoes: [{ id_instituicao: 'inst-1', nome_exibicao: 'IFMS Campus Campo Grande', sigla: 'IFMS-CG' }],
      areas_tematicas: [{ id_area: 'area-1', nome_area: 'Ciências Exatas' }],
      modalidades: [{ id_modalidade: 'mod-1', nome_modalidade: 'Ensino Médio' }],
      instituicao_aliases: [],
      modalidade_aliases: [],
    };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null } as never);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockarBanco();
  });

  describe('listagem', () => {
    it('deve mostrar o código do projeto e nunca o UUID', async () => {
      // Arrange / Act
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);

      // Assert
      expect(await screen.findByText('FETEC-001')).toBeInTheDocument();
      expect(screen.queryByText(UUID_PROJETO)).not.toBeInTheDocument();
    });

    it('deve listar só os projetos do evento ativo', async () => {
      // Arrange / Act
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Assert
      const filtros = chamadasDe('projetos', 'eq').map((c) => c.args);
      expect(filtros).toContainEqual(['id_evento', ID_EVENTO]);
    });

    it('deve vincular projetos legados sem evento ao evento ativo', async () => {
      // Arrange / Act
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Assert
      expect(chamadasDe('projetos', 'update').map((c) => c.args[0])).toContainEqual({ id_evento: ID_EVENTO });
      expect(chamadasDe('projetos', 'is').map((c) => c.args)).toContainEqual(['id_evento', null]);
    });

    it('deve ordenar o código em ordem natural (PROJ-2 antes de PROJ-10)', async () => {
      // Arrange
      dados.projetos = [
        projeto({ id_projeto: 'p-10', codigo_projeto: 'PROJ-10' }),
        projeto({ id_projeto: 'p-2', codigo_projeto: 'PROJ-2' }),
      ];

      // Act
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('PROJ-10');

      // Assert
      const codigos = screen.getAllByRole('row').slice(1).map((linha) => within(linha).getAllByRole('cell')[0].textContent);
      expect(codigos).toEqual(['PROJ-2', 'PROJ-10']);
      expect(screen.getByRole('columnheader', { name: /código/i })).toHaveAttribute('aria-sort', 'ascending');
    });

    it('deve inverter a ordenação pelo teclado no cabeçalho da coluna', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Act
      screen.getByRole('button', { name: /código/i }).focus();
      await user.keyboard('{Enter}');

      // Assert
      expect(screen.getByRole('columnheader', { name: /código/i })).toHaveAttribute('aria-sort', 'descending');
    });

    it('deve mostrar quantos projetos a busca encontrou do total', async () => {
      // Arrange
      const user = userEvent.setup();
      dados.projetos = [projeto(), projeto({ id_projeto: 'p-2', codigo_projeto: 'FETEC-002', titulo: 'Robótica' })];
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-002');

      // Act
      await user.type(screen.getByRole('textbox', { name: /buscar projetos/i }), 'robótica');

      // Assert
      expect(screen.getByText(/mostrando/i)).toHaveTextContent('Mostrando 1 de 2 projetos');
    });
  });

  describe('ações na linha', () => {
    it('deve priorizar o projeto no sorteio e anunciar o estado do botão', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      const botao = await screen.findByRole('button', { name: /prioridade no sorteio do projeto FETEC-001/i });
      expect(botao).toHaveAttribute('aria-pressed', 'false');

      // Act
      await user.click(botao);

      // Assert
      await waitFor(() => expect(chamadasDe('projetos', 'update').map((c) => c.args[0])).toContainEqual({ forcar_topo_fila: true }));
      expect(chamadasDe('projetos', 'eq').map((c) => c.args)).toContainEqual(['id_projeto', UUID_PROJETO]);
      expect(await screen.findByRole('button', { name: /prioridade no sorteio/i })).toHaveAttribute('aria-pressed', 'true');
    });

    it('deve mostrar o erro real do banco quando o check-in falha', async () => {
      // Arrange
      const user = userEvent.setup();
      erros['projetos.update'] = { code: '23514', message: 'violação de regra do projeto' };
      dados.projetos = [projeto()];
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');
      erros['projetos.update'] = { code: '23514', message: 'violação de regra do projeto' };

      // Act
      await user.click(screen.getByRole('button', { name: /check-in do projeto FETEC-001/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/violação de regra do projeto/i);
      expect(supabase.from).not.toHaveBeenCalledWith('projeto');
    });
  });

  describe('cadastro manual', () => {
    it('deve gravar o projeto no evento ativo com instituição, área, modalidade e fora da competição', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');
      await user.click(screen.getByRole('button', { name: /novo projeto/i }));

      // Act
      await user.type(screen.getByLabelText(/código do projeto/i), ' FETEC-050 ');
      await user.type(screen.getByLabelText(/título do projeto/i), 'Novo Projeto Robótica');
      await user.selectOptions(screen.getByLabelText(/^instituição$/i), 'inst-1');
      await user.click(screen.getByLabelText(/fora da competição/i));
      await user.click(screen.getByRole('button', { name: /cadastrar projeto/i }));

      // Assert
      await waitFor(() => expect(chamadasDe('projetos', 'insert')).toHaveLength(1));
      expect(chamadasDe('projetos', 'insert')[0].args[0]).toEqual([
        expect.objectContaining({
          codigo_projeto: 'FETEC-050',
          titulo: 'Novo Projeto Robótica',
          id_evento: ID_EVENTO,
          id_instituicao: 'inst-1',
          is_fora_da_competicao: true,
        }),
      ]);
    });

    it('deve explicar quando o código já existe no evento', async () => {
      // Arrange
      const user = userEvent.setup();
      erros['projetos.insert'] = { code: '23505', message: 'duplicate key value violates unique constraint "uq_projetos_evento_codigo"' };
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');
      await user.click(screen.getByRole('button', { name: /novo projeto/i }));

      // Act
      await user.type(screen.getByLabelText(/código do projeto/i), 'FETEC-001');
      await user.type(screen.getByLabelText(/título do projeto/i), 'Repetido');
      await user.click(screen.getByRole('button', { name: /cadastrar projeto/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um projeto com o código "FETEC-001" neste evento.');
    });

    it('deve recusar o cadastro sem evento ativo', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos />);
      await screen.findByText(/nenhum evento ativo/i);
      await user.click(screen.getByRole('button', { name: /novo projeto/i }));

      // Act
      await user.type(screen.getByLabelText(/título do projeto/i), 'Sem evento');
      await user.click(screen.getByRole('button', { name: /cadastrar projeto/i }));

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/nenhum evento ativo/i);
      expect(chamadasDe('projetos', 'insert')).toHaveLength(0);
    });
  });

  describe('importação por planilha', () => {
    it('deve gravar todos os projetos num único upsert pela chave (id_evento, codigo_projeto)', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Act
      await enviarPlanilha(user, [
        CABECALHO,
        'FETEC-001,Desenvolvimento Sustentável v2,EST-A01,A,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Não',
        'FETEC-002,Robótica Educacional,EST-A02,A,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Sim',
      ].join('\n'));

      // Assert
      await waitFor(() => expect(chamadasDe('projetos', 'upsert')).toHaveLength(1));
      const [linhas, opcoes] = chamadasDe('projetos', 'upsert')[0].args as [any[], unknown];
      expect(opcoes).toEqual({ onConflict: 'id_evento,codigo_projeto' });
      expect(CHAVE_NATURAL_PROJETOS).toBe('id_evento,codigo_projeto');
      expect(linhas).toHaveLength(2);
      expect(linhas[1]).toEqual(expect.objectContaining({
        codigo_projeto: 'FETEC-002', id_evento: ID_EVENTO, id_instituicao: 'inst-1', id_area: 'area-1', id_modalidade: 'mod-1', is_fora_da_competicao: true,
      }));
      expect(await screen.findByText(/importação concluída: 2 projetos/i, { selector: '[role="status"] span' })).toBeInTheDocument();
    });

    it('não deve desfazer check-in nem prioridade ao reimportar', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Act
      await enviarPlanilha(user, `${CABECALHO}\nFETEC-001,Título,EST-A01,A,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Não`);

      // Assert
      await waitFor(() => expect(chamadasDe('projetos', 'upsert')).toHaveLength(1));
      const [linhas] = chamadasDe('projetos', 'upsert')[0].args as [any[]];
      expect(linhas[0]).not.toHaveProperty('forcar_topo_fila');
      expect(linhas[0]).not.toHaveProperty('is_check_in_realizado');
    });

    it('deve cadastrar áreas novas num único lote antes dos projetos', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Act
      await enviarPlanilha(user, [
        CABECALHO,
        'FETEC-010,Projeto A,,,IFMS Campus Campo Grande,IFMS-CG,Ciências Biológicas,Ensino Médio,Não',
        'FETEC-011,Projeto B,,,IFMS Campus Campo Grande,IFMS-CG,Ciências Biológicas,Ensino Médio,Não',
        'FETEC-012,Projeto C,,,IFMS Campus Campo Grande,IFMS-CG,Linguística,Ensino Médio,Não',
      ].join('\n'));

      // Assert
      await waitFor(() => expect(chamadasDe('projetos', 'upsert')).toHaveLength(1));
      const lotesArea = chamadasDe('areas_tematicas', 'insert');
      expect(lotesArea).toHaveLength(1);
      expect((lotesArea[0].args[0] as any[]).map((a) => a.id_evento)).toEqual([ID_EVENTO, ID_EVENTO]);
      const [linhas] = chamadasDe('projetos', 'upsert')[0].args as [any[]];
      expect(linhas.map((l) => l.id_area)).toEqual(['areas_tematicas-novo-0', 'areas_tematicas-novo-0', 'areas_tematicas-novo-1']);
    });

    it('deve avisar código repetido na planilha e gravar só a última linha', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Act
      await enviarPlanilha(user, [
        CABECALHO,
        'FETEC-020,Primeira versão,,,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Não',
        'FETEC-020,Versão final,,,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Não',
      ].join('\n'));

      // Assert
      await waitFor(() => expect(chamadasDe('projetos', 'upsert')).toHaveLength(1));
      const [linhas] = chamadasDe('projetos', 'upsert')[0].args as [any[]];
      expect(linhas).toEqual([expect.objectContaining({ codigo_projeto: 'FETEC-020', titulo: 'Versão final' })]);
      expect(screen.getByRole('log', { name: /console de logs/i })).toHaveTextContent(/código "FETEC-020" repetido na planilha/i);
    });

    it('deve mostrar o erro do banco quando a gravação dos projetos falha', async () => {
      // Arrange
      const user = userEvent.setup();
      erros['projetos.upsert'] = { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' };
      render(<GestorProjetos id_evento_ativo={ID_EVENTO} />);
      await screen.findByText('FETEC-001');

      // Act
      await enviarPlanilha(user, `${CABECALHO}\nFETEC-030,Projeto,,,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Não`);

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/erro ao importar projetos: there is no unique/i);
    });

    it('deve recusar a importação sem evento ativo, sem gravar nada', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<GestorProjetos />);
      await screen.findByText(/nenhum evento ativo/i);

      // Act
      await enviarPlanilha(user, `${CABECALHO}\nFETEC-040,Projeto,,,IFMS Campus Campo Grande,IFMS-CG,Ciências Exatas,Ensino Médio,Não`);

      // Assert
      expect(await screen.findByRole('alert')).toHaveTextContent(/nenhum evento ativo/i);
      expect(chamadasDe('projetos', 'upsert')).toHaveLength(0);
      expect(screen.getByRole('log', { name: /console de logs/i })).not.toHaveTextContent(/evt-1/);
    });
  });

  it('sem evento ativo deve avisar e não listar projetos de outros eventos, nem de um evento guardado no navegador', async () => {
    // Arrange
    localStorage.setItem('evento_ativo_id', 'evento-do-ano-passado');

    // Act
    render(<GestorProjetos id_evento_ativo="" />);

    // Assert
    expect(await screen.findByText(/nenhum evento ativo/i)).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
    localStorage.removeItem('evento_ativo_id');
  });
});
