import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Loader2,
  AlertTriangle,
  FolderGit2,
  Lock,
  Users,
  UserCog,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Building,
  RefreshCw,
  FileText,
  UserPlus,
  User,
  Mail,
  Trash2,
  Pencil,
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '@/lib/supabase';
import { GestorAvaliadores } from '@/features/avaliadores';
import { GestorStaff } from '@/features/staff';

export type TipoDetalhamentoModal =
  | 'projetos'
  | 'locks'
  | 'quarentena'
  | 'avaliadores'
  | 'staff'
  | 'administradores'
  | 'avaliacoes';

interface ModalDetalhamentoProps {
  tipo: TipoDetalhamentoModal;
  titulo: string;
  id_evento_ativo?: string;
  ao_fechar: () => void;
  aoAtualizarMetricas?: () => void;
}

export const ModalDetalhamento: React.FC<ModalDetalhamentoProps> = ({
  tipo,
  titulo,
  id_evento_ativo = 'evt-2026-ifms',
  ao_fechar,
  aoAtualizarMetricas,
}) => {
  // Se for avaliadores ou staff, renderiza os gestores completos diretamente
  if (tipo === 'avaliadores') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
          <GestorAvaliadores id_evento_ativo={id_evento_ativo} ao_fechar={ao_fechar} aoAtualizarMetricas={aoAtualizarMetricas} />
        </div>
      </div>
    );
  }

  if (tipo === 'staff') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] my-auto flex flex-col">
          <GestorStaff ao_fechar={ao_fechar} id_evento_ativo={id_evento_ativo} aoAtualizarMetricas={aoAtualizarMetricas} />
        </div>
      </div>
    );
  }

  const [carregando, set_carregando] = useState<boolean>(true);
  const [registros, set_registros] = useState<any[]>([]);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Estados de ordenação de colunas
  const [colunaOrdenacao, setColunaOrdenacao] = useState<string>('');
  const [ordemAscendente, setOrdemAscendente] = useState<boolean>(true);

  // Estados para formulário inline de Administradores
  const [novo_admin_nome, set_novo_admin_nome] = useState<string>('');
  const [novo_admin_email, set_novo_admin_email] = useState<string>('');
  const [salvando_admin, set_salvando_admin] = useState<boolean>(false);

  // Estados para edição inline de Administrador
  const [admin_em_edicao, set_admin_em_edicao] = useState<any | null>(null);
  const [edit_admin_nome, set_edit_admin_nome] = useState<string>('');
  const [edit_admin_email, set_edit_admin_email] = useState<string>('');
  const [edit_admin_papel, set_edit_admin_papel] = useState<string>('ADMIN');
  const [salvando_edicao_admin, set_salvando_edicao_admin] = useState<boolean>(false);

  const conexao_banco = verificar_conexao_configurada();

  const carregar_dados_reais = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      set_registros([]);
      set_carregando(false);
      return;
    }

    try {
      if (tipo === 'projetos') {
        const { data, error } = await supabase
          .from('projetos')
          .select('id_projeto, codigo_projeto, titulo, estande, corredor, is_check_in_realizado, id_instituicao, instituicoes(nome_exibicao), modalidades(nome_modalidade), areas_tematicas(nome_area)')
          .order('estande', { ascending: true });

        if (error) {
          // Tenta tabela singular como fallback
          const { data: dataSingular, error: errSing } = await supabase
            .from('projeto')
            .select('*');
          if (errSing) throw error;
          set_registros(dataSingular || []);
        } else {
          set_registros(data || []);
        }
      } else if (tipo === 'locks') {
        // Query com JOIN em projetos para ler codigo_projeto
        const { data, error } = await supabase
          .from('locks_ativos')
          .select('id_projeto, id_usuario, expira_em, projetos(codigo_projeto)');

        if (error) throw error;
        set_registros(data || []);
      } else if (tipo === 'quarentena') {
        // Query com JOIN em projetos para ler codigo_projeto
        const { data, error } = await supabase
          .from('avaliacoes')
          .select('id_avaliacao, nota_final, is_quarentena, id_projeto, id_usuario, parecer_final, projetos(codigo_projeto)')
          .eq('is_quarentena', true);

        if (error) throw error;
        set_registros(data || []);
      } else if (tipo === 'administradores') {
        // Busca sem .eq('papel') para evitar erro de enum case-sensitive
        const { data, error } = await supabase
          .from('usuarios')
          .select('id_usuario, nome, email, papel');

        if (error) throw error;
        const admins_filtrados = (data || []).filter(
          (user) => user.papel?.toUpperCase() === 'ADMIN' || user.papel?.toUpperCase() === 'SUPERADMIN'
        );
        set_registros(admins_filtrados);
      } else if (tipo === 'avaliacoes') {
        const { data, error } = await supabase
          .from('avaliacoes')
          .select('id_avaliacao, id_projeto, id_usuario, nota_final, status, status_avaliacao, parecer_final, projetos(codigo_projeto)')
          .limit(100);

        if (error) throw error;
        set_registros(data || []);
      }
    } catch (e: any) {
      console.error(`Erro ao carregar dados reais do modal (${tipo}):`, e);
      set_mensagem_erro(`Erro do Supabase: ${e.message || 'Falha ao consultar tabela'}`);
      set_registros([]);
    } finally {
      set_carregando(false);
    }
  };

  useEffect(() => {
    carregar_dados_reais();
  }, [tipo]);

  // Funções de Gestão de Administradores
  const handle_adicionar_admin = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = novo_admin_nome.trim();
    const email = novo_admin_email.toLowerCase().trim();

    if (!nome || !email) {
      alert('Preencha o Nome e o E-mail do Administrador.');
      return;
    }

    set_salvando_admin(true);
    set_mensagem_erro(null);

    try {
      if (conexao_banco) {
        const { error } = await supabase.from('usuarios').insert([{ nome, email, papel: 'ADMIN' }]);
        if (error) {
          throw error;
        }
      }

      // Atualize a lista localmente após o sucesso
      const novoAdmin = {
        id_usuario: crypto.randomUUID(),
        nome,
        email,
        papel: 'ADMIN'
      };
      set_registros((prev) => [novoAdmin, ...prev]);
      set_novo_admin_nome('');
      set_novo_admin_email('');

      if (conexao_banco) {
        await carregar_dados_reais();
      }
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao adicionar administrador:', err);
      alert(`Erro ao adicionar administrador: ${err.message || err}`);
    } finally {
      set_salvando_admin(false);
    }
  };

  const handle_excluir_admin = async (admin: any) => {
    const totalAdmins = registros.filter(
      (u) => u.papel?.toUpperCase() === 'ADMIN' || u.papel?.toUpperCase() === 'SUPERADMIN'
    ).length;

    if (totalAdmins <= 1) {
      alert('Ação bloqueada: Não é permitido excluir o único administrador restante no sistema.');
      return;
    }

    const confirmado = window.confirm(
      `Tem certeza de que deseja remover o administrador "${admin.nome}" (${admin.email})?\n\nAtenção: Caso este seja o seu próprio usuário, você perderá acesso às funções administrativas do sistema.`
    );
    if (!confirmado) return;

    try {
      if (conexao_banco && admin.id_usuario) {
        const { error } = await supabase.from('usuarios').delete().eq('id_usuario', admin.id_usuario);
        if (error) throw error;
      }

      // Atualiza lista localmente
      set_registros((prev) => prev.filter((u) => u.id_usuario !== admin.id_usuario));
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao excluir administrador:', err);
      alert(`Erro ao excluir administrador: ${err.message || err}`);
    }
  };

  const iniciar_edicao_admin = (admin: any) => {
    set_admin_em_edicao(admin);
    set_edit_admin_nome(admin.nome || '');
    set_edit_admin_email(admin.email || '');
    set_edit_admin_papel(admin.papel?.toUpperCase() || 'ADMIN');
  };

  const cancelar_edicao_admin = () => {
    set_admin_em_edicao(null);
  };

  const handle_salvar_edicao_admin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admin_em_edicao) return;

    const nome = edit_admin_nome.trim();
    const email = edit_admin_email.toLowerCase().trim();
    const papel = edit_admin_papel.toUpperCase();

    if (!nome || !email) {
      alert('Preencha o Nome e o E-mail do Administrador.');
      return;
    }

    set_salvando_edicao_admin(true);
    try {
      if (conexao_banco && admin_em_edicao.id_usuario) {
        const { error } = await supabase
          .from('usuarios')
          .update({ nome, email, papel })
          .eq('id_usuario', admin_em_edicao.id_usuario);
        if (error) throw error;
      }

      set_registros((prev) =>
        prev.map((u) =>
          u.id_usuario === admin_em_edicao.id_usuario
            ? { ...u, nome, email, papel }
            : u
        )
      );
      set_admin_em_edicao(null);
      if (aoAtualizarMetricas) aoAtualizarMetricas();
    } catch (err: any) {
      console.error('Erro ao editar administrador:', err);
      alert(`Erro ao editar administrador: ${err.message || err}`);
    } finally {
      set_salvando_edicao_admin(false);
    }
  };

  // Filtragem dos registros
  const registros_filtrados = registros.filter((item) => {
    if (!termo_busca.trim()) return true;
    const termo = termo_busca.toLowerCase().trim();
    const textoCompleto = JSON.stringify(item).toLowerCase();
    return textoCompleto.includes(termo);
  });

  const alternarOrdenacao = (coluna: string) => {
    if (colunaOrdenacao === coluna) {
      setOrdemAscendente(!ordemAscendente);
    } else {
      setColunaOrdenacao(coluna);
      setOrdemAscendente(true);
    }
  };

  const renderIconeOrdenacao = (coluna: string) => {
    if (colunaOrdenacao !== coluna) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-40 hover:opacity-100 transition-opacity ml-1 inline-block shrink-0" />;
    }
    return ordemAscendente
      ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-1 inline-block shrink-0" />
      : <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-1 inline-block shrink-0" />;
  };

  const extrairValorCampo = (item: any, campo: string) => {
    if (campo === 'codigo_projeto') {
      const proj = Array.isArray(item.projetos) ? item.projetos[0] : item.projetos;
      return item.codigo_projeto || proj?.codigo_projeto || '';
    }
    if (campo === 'instituicao') {
      const inst = Array.isArray(item.instituicoes) ? item.instituicoes[0] : item.instituicoes;
      return inst?.nome_exibicao || item.nome_instituicao || '';
    }
    if (campo === 'modalidade') {
      const mod = Array.isArray(item.modalidades) ? item.modalidades[0] : item.modalidades;
      return mod?.nome_modalidade || item.modalidade || '';
    }
    return item[campo];
  };

  const registros_ordenados = [...registros_filtrados].sort((a, b) => {
    if (!colunaOrdenacao) return 0;
    let valA = extrairValorCampo(a, colunaOrdenacao);
    let valB = extrairValorCampo(b, colunaOrdenacao);
    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';
    if (typeof valA === 'boolean') {
      const numA = valA ? 1 : 0;
      const numB = valB ? 1 : 0;
      return ordemAscendente ? numA - numB : numB - numA;
    }
    if (typeof valA === 'number' && typeof valB === 'number') {
      return ordemAscendente ? valA - valB : valB - valA;
    }
    const comp = String(valA).localeCompare(String(valB), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return ordemAscendente ? comp : -comp;
  });

  const extrair_icone = () => {
    switch (tipo) {
      case 'projetos':
        return <FolderGit2 className="w-5 h-5 text-emerald-600" />;
      case 'locks':
        return <Lock className="w-5 h-5 text-amber-600" />;
      case 'quarentena':
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case 'administradores':
        return <ShieldCheck className="w-5 h-5 text-purple-600" />;
      default:
        return <FileText className="w-5 h-5 text-emerald-600" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-[98vw] max-w-[98vw] h-[95vh] max-h-[95vh] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho do Modal */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs">
              {extrair_icone()}
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                {titulo}
                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  {registros_ordenados.length} {tipo === 'administradores' ? (registros_ordenados.length === 1 ? 'administrador' : 'administradores') : (registros_ordenados.length === 1 ? 'registro' : 'registros')}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={carregar_dados_reais}
              disabled={carregando}
              title="Recarregar do Supabase"
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700"
            >
              <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
            <button
              type="button"
              onClick={ao_fechar}
              className="p-2.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Barra de Busca */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={termo_busca}
              onChange={(e) => set_termo_busca(e.target.value)}
              placeholder="Pesquisar nos registros desta tabela..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Mensagem de Erro (se houver) */}
        {mensagem_erro && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{mensagem_erro}</span>
          </div>
        )}

        {/* Conteúdo com Tabela e Rolagem */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Formulário Inline de Inclusão de Administrador (Requisito 3) */}
          {tipo === 'administradores' && (
            <div className="bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-purple-900 dark:text-purple-300 font-extrabold text-xs uppercase tracking-wider">
                <UserPlus className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span>Adicionar Novo Administrador</span>
              </div>
              <form onSubmit={handle_adicionar_admin} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative flex-1">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={novo_admin_nome}
                    onChange={(e) => set_novo_admin_nome(e.target.value)}
                    placeholder="Nome do Administrador"
                    required
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="relative flex-1">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={novo_admin_email}
                    onChange={(e) => set_novo_admin_email(e.target.value)}
                    placeholder="E-mail do Administrador"
                    required
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={salvando_admin}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-extrabold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {salvando_admin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  <span>Adicionar Admin</span>
                </button>
              </form>
            </div>
          )}
          {carregando ? (
            <div className="p-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Consultando dados no Supabase...
              </p>
            </div>
          ) : registros_filtrados.length === 0 ? (
            <div className="p-12 text-center space-y-2 border border-dashed rounded-2xl dark:border-slate-800">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Nenhum registro encontrado.
              </p>
              <p className="text-[11px] text-slate-400">
                {termo_busca ? 'Tente ajustar os termos de pesquisa.' : 'A tabela selecionada não possui registros cadastrados.'}
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                {/* Cabeçalho da Tabela de acordo com o Tipo */}
                <thead className="bg-slate-100 dark:bg-slate-800 uppercase font-black text-[10px] text-slate-600 dark:text-slate-400 tracking-wider">
                  {tipo === 'projetos' && (
                    <tr>
                      <th onClick={() => alternarOrdenacao('codigo_projeto')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>CÓDIGO</span>{renderIconeOrdenacao('codigo_projeto')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('corredor')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Corredor</span>{renderIconeOrdenacao('corredor')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('estande')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Estande</span>{renderIconeOrdenacao('estande')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('titulo')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Título do Projeto</span>{renderIconeOrdenacao('titulo')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('instituicao')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Instituição</span>{renderIconeOrdenacao('instituicao')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('modalidade')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Modalidade</span>{renderIconeOrdenacao('modalidade')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('is_check_in_realizado')} className="px-4 py-3 text-center cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center justify-center gap-1"><span>Check-in</span>{renderIconeOrdenacao('is_check_in_realizado')}</div>
                      </th>
                    </tr>
                  )}

                  {tipo === 'locks' && (
                    <tr>
                      <th onClick={() => alternarOrdenacao('codigo_projeto')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>CÓDIGO</span>{renderIconeOrdenacao('codigo_projeto')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('id_usuario')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>ID do Usuário (Avaliador)</span>{renderIconeOrdenacao('id_usuario')}</div>
                      </th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  )}

                  {tipo === 'quarentena' && (
                    <tr>
                      <th onClick={() => alternarOrdenacao('id_avaliacao')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>ID Avaliação</span>{renderIconeOrdenacao('id_avaliacao')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('codigo_projeto')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>CÓDIGO</span>{renderIconeOrdenacao('codigo_projeto')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('id_usuario')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>ID Usuário</span>{renderIconeOrdenacao('id_usuario')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('nota_final')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Nota Final</span>{renderIconeOrdenacao('nota_final')}</div>
                      </th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  )}

                  {tipo === 'administradores' && (
                    <tr>
                      <th onClick={() => alternarOrdenacao('nome')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Nome</span>{renderIconeOrdenacao('nome')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('email')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>E-mail</span>{renderIconeOrdenacao('email')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('papel')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Papel</span>{renderIconeOrdenacao('papel')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('id_usuario')} className="px-4 py-3 font-mono text-xs cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>ID Usuário</span>{renderIconeOrdenacao('id_usuario')}</div>
                      </th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  )}

                  {tipo === 'avaliacoes' && (
                    <tr>
                      <th onClick={() => alternarOrdenacao('id_avaliacao')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>ID Avaliação</span>{renderIconeOrdenacao('id_avaliacao')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('codigo_projeto')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>CÓDIGO</span>{renderIconeOrdenacao('codigo_projeto')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('id_usuario')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>ID Usuário</span>{renderIconeOrdenacao('id_usuario')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('nota_final')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Nota Final</span>{renderIconeOrdenacao('nota_final')}</div>
                      </th>
                      <th onClick={() => alternarOrdenacao('status_avaliacao')} className="px-4 py-3 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-700">
                        <div className="flex items-center gap-1"><span>Status</span>{renderIconeOrdenacao('status_avaliacao')}</div>
                      </th>
                    </tr>
                  )}
                </thead>

                {/* Corpo da Tabela */}
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {tipo === 'projetos' &&
                    registros_ordenados.map((p, idx) => {
                      const dados_inst = Array.isArray(p.instituicoes) ? p.instituicoes[0] : p.instituicoes;
                      const dados_mod = Array.isArray(p.modalidades) ? p.modalidades[0] : p.modalidades;
                      const inst_nome = dados_inst?.nome_exibicao || p.nome_instituicao || 'Sem Instituição';
                      const mod_nome = dados_mod?.nome_modalidade || p.modalidade || 'Geral';
                      const presente = Boolean(p.is_check_in_realizado);
                      const corredor_nome = p.corredor || 'S/ Corredor';
                      const estande_codigo = p.estande || 'S/ ESTANDE';
                      const codigo_proj = p.codigo_projeto || 'N/I';

                      return (
                        <tr key={p.id_projeto || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {codigo_proj}
                          </td>
                          <td className="px-4 py-3 font-semibold text-teal-600 dark:text-teal-400 whitespace-nowrap">
                            {corredor_nome}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {estande_codigo}
                          </td>
                          <td className="px-4 py-3 font-semibold max-w-xs">{p.titulo || p.titulo_projeto}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{inst_nome}</td>
                          <td className="px-4 py-3 text-slate-500">{mod_nome}</td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                presente
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {presente ? 'Presente' : 'Pendente'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                  {tipo === 'locks' &&
                    registros_ordenados.map((lock, idx) => {
                      const proj = Array.isArray(lock.projetos) ? lock.projetos[0] : lock.projetos;
                      const codProj = proj?.codigo_projeto || lock.codigo_projeto || 'N/I';
                      return (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-mono font-bold text-amber-600 whitespace-nowrap">
                            {codProj}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                            {lock.id_usuario}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 animate-pulse">
                              Bloqueado
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                  {tipo === 'quarentena' &&
                    registros_ordenados.map((q, idx) => {
                      const projQ = Array.isArray(q.projetos) ? q.projetos[0] : q.projetos;
                      const codQ = projQ?.codigo_projeto || q.codigo_projeto || 'N/I';
                      return (
                        <tr key={q.id_avaliacao || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                            {q.id_avaliacao}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {codQ}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                            {q.id_usuario}
                          </td>
                          <td className="px-4 py-3 font-bold text-red-600">
                            {q.nota_final ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                              Em Quarentena
                            </span>
                          </td>
                        </tr>
                      );
                    })}

                  {tipo === 'administradores' &&
                    registros_ordenados.map((u, idx) => {
                      const estaEditando = admin_em_edicao?.id_usuario === u.id_usuario;

                      if (estaEditando) {
                        return (
                          <tr key={u.id_usuario || idx} className="bg-purple-50/80 dark:bg-purple-950/40 border-y border-purple-200 dark:border-purple-800">
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={edit_admin_nome}
                                onChange={(e) => set_edit_admin_nome(e.target.value)}
                                placeholder="Nome"
                                className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 rounded-lg text-xs font-bold text-slate-900 dark:text-white"
                                required
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="email"
                                value={edit_admin_email}
                                onChange={(e) => set_edit_admin_email(e.target.value)}
                                placeholder="E-mail"
                                className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 rounded-lg text-xs font-mono text-slate-900 dark:text-white"
                                required
                              />
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={edit_admin_papel}
                                onChange={(e) => set_edit_admin_papel(e.target.value)}
                                className="px-2 py-1.5 bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 rounded-lg text-xs font-bold text-slate-900 dark:text-white"
                              >
                                <option value="ADMIN">ADMIN</option>
                                <option value="SUPERADMIN">SUPERADMIN</option>
                              </select>
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-400">
                              {u.id_usuario}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <div className="inline-flex items-center gap-1.5 justify-end">
                                <button
                                  type="button"
                                  onClick={handle_salvar_edicao_admin}
                                  disabled={salvando_edicao_admin}
                                  title="Salvar Alterações"
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  {salvando_edicao_admin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                  <span>Salvar</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelar_edicao_admin}
                                  title="Cancelar"
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={u.id_usuario || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{u.nome}</td>
                          <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                              {u.papel || 'ADMIN'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{u.id_usuario}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => iniciar_edicao_admin(u)}
                                title="Editar Administrador"
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-purple-100 dark:bg-slate-800 dark:hover:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-slate-200 dark:border-slate-700 font-bold text-xs transition-all inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Editar</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handle_excluir_admin(u)}
                                title="Excluir Administrador"
                                className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-bold text-xs transition-all inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Excluir</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                  {tipo === 'avaliacoes' &&
                    registros_ordenados.map((av, idx) => {
                      const projAv = Array.isArray(av.projetos) ? av.projetos[0] : av.projetos;
                      const codAv = projAv?.codigo_projeto || av.codigo_projeto || 'N/I';
                      return (
                        <tr key={av.id_avaliacao || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                            {av.id_avaliacao}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {codAv}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                            {av.id_usuario}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">
                            {av.nota_final ?? '-'}
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              {av.status_avaliacao || 'Concluída'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rodapé com Fechamento */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={ao_fechar}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all shadow-xs"
          >
            Fechar Janela
          </button>
        </div>
      </div>
    </div>
  );
};
