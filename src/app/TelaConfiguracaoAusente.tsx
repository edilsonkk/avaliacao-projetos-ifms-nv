import { AlertTriangle } from 'lucide-react';

interface TelaConfiguracaoAusenteProps {
  problemas: string[];
}

/** Exibida no lugar da aplicação quando as variáveis de ambiente obrigatórias não estão configuradas. */
export function TelaConfiguracaoAusente({ problemas }: TelaConfiguracaoAusenteProps) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <section className="w-full max-w-xl rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-800 p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-xl font-bold text-red-700 dark:text-red-400">
          <AlertTriangle aria-hidden="true" className="w-6 h-6" />
          Configuração do Supabase ausente
        </h1>
        <ul className="mt-4 list-disc pl-6 text-slate-700 dark:text-slate-200">
          {problemas.map((problema) => (
            <li key={problema}>{problema}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          Em desenvolvimento, crie o arquivo de ambiente e preencha com os dados do Supabase local:
        </p>
        <pre className="mt-2 rounded bg-slate-100 dark:bg-slate-900 p-3 text-sm text-slate-800 dark:text-slate-100">
          cp .env.example .env
        </pre>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          Guia completo: docs/arquitetura/configuracao.md
        </p>
      </section>
    </main>
  );
}
