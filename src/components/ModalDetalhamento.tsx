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
  Trash2
} from 'lucide-react';
import { supabase, verificar_conexao_configurada } from '../lib/supabase';
import { GestorAvaliadores } from './GestorAvaliadores';
import { GestorStaff } from './GestorStaff';

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
}

export const ModalDetalhamento: React.FC<ModalDetalhamentoProps> = ({
  tipo,
  titulo,
  id_evento_ativo = 'evt-2026-ifms',
  ao_fechar,
}) => {
  // Se for avaliadores ou staff, renderiza os gestores completos diretamente
  if (tipo === 'avaliadores') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto">
          <GestorAvaliadores id_evento_ativo={id_evento_ativo} ao_fechar={ao_fechar} />
        </div>
      </div>
    );
  }

  if (tipo === 'staff') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-6xl my-auto max-h-[92vh] overflow-y-auto">
          <GestorStaff ao_fechar={ao_fechar} />
        </div>
      </div>
    );
  }

  const [carregando, set_carregando] = useState<boolean>(true);
  const [registros, set_registros] = useState<any[]>([]);
  const [mensagem_erro, set_mensagem_erro] = useState<string | null>(null);
  const [termo_busca, set_termo_busca] = useState<string>('');

  // Estados para formulário inline de Administradores
  const [novo_admin_nome, set_novo_admin_nome] = useState<string>('');
  const [novo_admin_email, set_novo_admin_email] = useState<string>('');
  const [salvando_admin, set_salvando_admin] = useState<boolean>(false);

  const conexao_banco = verificar_conexao_configurada();

  const carregar_dados_reais = async () => {
    set_carregando(true);
    set_mensagem_erro(null);

    if (!conexao_banco) {
      // Mock / fallback amigável quando banco não configurado
      gerar_dados_contingencia();
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
          .select('id_projeto, id_usuario, projetos(codigo_projeto)');

        if (error) throw error;
        set_registros(data || []);
      } else if (tipo === 'quarentena') {
        // Query com JOIN em projetos para ler codigo_projeto
        const { data, error } = await supabase
          .from('avaliacoes')
          .select('id_avaliacao, nota_final, is_quarentena, id_projeto, id_usuario, projetos(codigo_projeto)')
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
          .select('id_avaliacao, id_projeto, id_usuario, nota_final, status_avaliacao, parecer_final, projetos(codigo_projeto)')
          .limit(100);

        if (error) throw error;
        set_registros(data || []);
      }
    } catch (e: any) {
      console.error(`Erro ao carregar dados reais do modal (${tipo}):`, e);
      set_mensagem_erro(`Erro do Supabase: ${e.message || 'Falha ao consultar tabela'}`);
      gerar_dados_contingencia();
    } finally {
      set_carregando(false);
    }
  };

  const gerar_dados_contingencia = () => {
    if (tipo === 'projetos') {
      set_registros([
        { id_projeto: 'p1', codigo_projeto: 'FETEC-001', estande: 'EST-A01', corredor: 'Corredor A', titulo: 'Dispositivo IoT para Monitoramento Agrícola', instituicoes: { nome_exibicao: 'IFMS Câmpus Campo Grande' }, modalidades: { nome_modalidade: 'Pesquisa Aplicada' }, is_check_in_realizado: true },
        { id_projeto: 'p2', codigo_projeto: 'FETEC-002', estande: 'EST-A02', corredor: 'Corredor A', titulo: 'Sistema Web de Gestão de Resíduos Orgânicos', instituicoes: { nome_exibicao: 'IFMS Câmpus Dourados' }, modalidades: { nome_modalidade: 'Extensão Tecnológica' }, is_check_in_realizado: false },
        { id_projeto: 'p3', codigo_projeto: 'FETEC-003', estande: 'EST-B05', corredor: 'Corredor B', titulo: 'Análise Fisico-Química de Extratos Botânicos', instituicoes: { nome_exibicao: 'IFMS Câmpus Corumbá' }, modalidades: { nome_modalidade: 'Iniciação Científica' }, is_check_in_realizado: true },
      ]);
    } else if (tipo === 'locks') {
      set_registros([
        { id_projeto: 'proj-01-iot', codigo_projeto: 'FETEC-001', id_usuario: 'usr-101' },
        { id_projeto: 'proj-02-bio', codigo_projeto: 'FETEC-002', id_usuario: 'usr-102' },
      ]);
    } else if (tipo === 'quarentena') {
      set_registros([
        { id_avaliacao: 'aval-q1', id_projeto: 'proj-01-iot', codigo_projeto: 'FETEC-001', id_usuario: 'usr-101', nota_final: 72.5, is_quarentena: true },
        { id_avaliacao: 'aval-q2', id_projeto: 'proj-05-rob', codigo_projeto: 'FETEC-005', id_usuario: 'usr-105', nota_final: 65.0, is_quarentena: true },
      ]);
    } else if (tipo === 'administradores') {
      set_registros([
        { id_usuario: 'a1', nome: 'Coordenação Geral da FETEC', email: 'coord.fetec@ifms.edu.br', papel: 'SUPERADMIN' },
        { id_usuario: 'a2', nome: 'Administrador de Sistema IFMS', email: 'admin.sistemas@ifms.edu.br', papel: 'ADMIN' },
      ]);
    } else if (tipo === 'avaliacoes') {
      set_registros([
        { id_avaliacao: 'av1', id_projeto: 'proj-01', id_usuario: 'usr-101', nota_final: 94.5, status_avaliacao: 'concluida' },
      ]);
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
    } catch (err: any) {
      console.error('Erro ao excluir administrador:', err);
      alert(`Erro ao excluir administrador: ${err.message || err}`);
    }
  };

  // Filtragem dos registros
  const registros_filtrados = registros.filter((item) => {
    if (!termo_busca.trim()) return true;
    const termo = termo_busca.toLowerCase().trim();
    const textoCompleto = JSON.stringify(item).toLowerCase();
    return textoCompleto.includes(termo);
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
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-5xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho do Modal */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs">
              {extrair_icone()}
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                {titulo}
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {registros_filtrados.length} {registros_filtrados.length === 1 ? 'registro' : 'registros'}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Consulta real no Supabase na tabela correspondente.
              </p>
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
                      <th className="px-4 py-3">CÓDIGO</th>
                      <th className="px-4 py-3">Corredor</th>
                      <th className="px-4 py-3">Estande</th>
                      <th className="px-4 py-3">Título do Projeto</th>
                      <th className="px-4 py-3">Instituição</th>
                      <th className="px-4 py-3">Modalidade</th>
                      <th className="px-4 py-3 text-center">Check-in</th>
                    </tr>
                  )}

                  {tipo === 'locks' && (
                    <tr>
                      <th className="px-4 py-3">CÓDIGO</th>
                      <th className="px-4 py-3">ID do Usuário (Avaliador)</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  )}

                  {tipo === 'quarentena' && (
                    <tr>
                      <th className="px-4 py-3">ID Avaliação</th>
                      <th className="px-4 py-3">CÓDIGO</th>
                      <th className="px-4 py-3">ID Usuário (Avaliador)</th>
                      <th className="px-4 py-3">Nota Final</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  )}

                  {tipo === 'administradores' && (
                    <tr>
                      <th className="px-4 py-3">Nome</th>
                      <th className="px-4 py-3">E-mail</th>
                      <th className="px-4 py-3">Papel</th>
                      <th className="px-4 py-3 font-mono text-xs">ID Usuário</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  )}

                  {tipo === 'avaliacoes' && (
                    <tr>
                      <th className="px-4 py-3">ID Avaliação</th>
                      <th className="px-4 py-3">CÓDIGO</th>
                      <th className="px-4 py-3">ID Usuário</th>
                      <th className="px-4 py-3">Nota Final</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  )}
                </thead>

                {/* Corpo da Tabela */}
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {tipo === 'projetos' &&
                    registros_filtrados.map((p, idx) => {
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
                    registros_filtrados.map((lock, idx) => {
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
                    registros_filtrados.map((q, idx) => {
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
                    registros_filtrados.map((u, idx) => (
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
                          <button
                            type="button"
                            onClick={() => handle_excluir_admin(u)}
                            title="Excluir Administrador"
                            className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 font-bold text-xs transition-all inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Excluir</span>
                          </button>
                        </td>
                      </tr>
                    ))}

                  {tipo === 'avaliacoes' &&
                    registros_filtrados.map((av, idx) => {
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
