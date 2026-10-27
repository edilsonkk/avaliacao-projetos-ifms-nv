# Diretrizes de Desenvolvimento e Testes Automatizados (TDD)

## 1. Princípios Gerais de Teste
- **Executor**: Vitest (^4.1.12) com JSDOM para componentes React e ambiente Node/ESM para funções puras.
- **Metodologia TDD**: Nenhuma funcionalidade ou correção de bug é considerada concluída sem o seu respectivo teste automatizado passando.
- **Cobertura**: Não exigimos porcentagem fixa de cobertura no CI (para evitar testes artificiais). Porém, é OBRIGATÓRIO incluir testes unitários/integração para 100% do código novo ou das funções refatoradas antes de considerar a tarefa concluída.
- **Qualidade**: O código de teste deve ser limpo, focado e estritamente tipado com TypeScript (evitar `any`).
- **Isolamento**: Testes não devem fazer requisições reais à internet ou ao banco PostgreSQL do Supabase.

---

## 2. Regras Específicas por Camada

### A. Utilitários, Parsers e Planilhas (`exceljs`)
- Parsers ficam em `src/lib/parsers/` como funções puras (sem React), com testes em `src/lib/parsers/__tests__/`.
- Teste funções puras sem carregar o JSDOM (anotação `// @vitest-environment node`).
- Garanta testes para:
  1. Sucesso no parsing de planilhas bem formatadas.
  2. Tratamento de exceção para arquivos `.xlsx`/`.xls` vazios ou corrompidos.
  3. Mapeamento correto de tipos de dados (Datas, Números, Strings).

### B. Custom Hooks & Supabase JS (`@supabase/supabase-js`)
- Sempre que criar uma nova funcionalidade ou refatorar um componente existente, isole as chamadas ao Supabase em um custom hook.
- Em componentes legados não modificados, mantenha o mock direto do SDK do Supabase no Vitest.
- Utilize `renderHook()` do `@testing-library/react`.
- Mocke o SDK usando `vi.mock('@/lib/supabase')` e crie Factory Functions para os dados retornados.
- Teste obrigatoriamente os 3 estados do Hook:
  1. Estado inicial e `loading: true`.
  2. Retorno com sucesso (`data` populado e `error: null`).
  3. Tratativa de erro (`data: null` e objeto `error` preenchido).

### C. Componentes de UI (React 19 + Tailwind + Motion)
- Use `@testing-library/react` e `@testing-library/user-event`.
- **Foco no Usuário**: Selecione elementos primariamente por acessibilidade (`screen.getByRole`, `screen.getByLabelText`, `screen.getByText`). Campos de formulário devem ter `<label htmlFor>` e botões só com ícone devem ter `aria-label`.
- **Proibições**: NUNCA selecione por classes CSS do Tailwind, `querySelector` genérico ou inspecione estados internos do React (`useState`).
- Teste o feedback visual das interações (cliques, submissão de formulários, alertas que aparecem/somem), sem verificar detalhes internos das animações do Motion.

---

## 3. Padrão de Estrutura dos Arquivos de Teste

Todo arquivo de teste deve seguir o padrão Arrange-Act-Assert (AAA):

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MeuComponente } from '@/features/minha-feature';

describe('MeuComponente', () => {
  it('deve submeter os dados corretamente ao clicar no botão', async () => {
    // Arrange (Preparar)
    const user = userEvent.setup();
    const handleSave = vi.fn();
    render(<MeuComponente onSave={handleSave} />);

    // Act (Agir)
    await user.type(screen.getByRole('textbox', { name: /nome/i }), 'Dados de Teste');
    await user.click(screen.getByRole('button', { name: /salvar/i }));

    // Assert (Verificar)
    expect(handleSave).toHaveBeenCalledWith('Dados de Teste');
  });
});
```

---

## 4. Migração de Testes Legados
- Testes novos ou alterados devem usar `userEvent` e seletores acessíveis.
- Testes legados são migrados gradualmente, sempre que o arquivo for tocado.

---

## 5. Regras de Performance e Execução de Testes
- **Ambientes Isolados**:
  - Para utilitários e funções puras (ex.: parsers de Excel, formatadores), adicione a anotação `// @vitest-environment node` no topo do arquivo de teste para ignorar o JSDOM e rodar em Node puro.
  - Para componentes React e Hooks de UI, use o ambiente padrão `jsdom`.
- **Execução sem Bloqueios**:
  - NUNCA use `setTimeout` ou delays arbitrários nos testes. Use `findByRole` ou `waitFor` do React Testing Library para asserções assíncronas.
  - Limpe timers e mocks automaticamente entre os testes para evitar acúmulo de memória.
- **Comandos do Terminal**:
  - Em desenvolvimento local (dev): Use `npx vitest` (modo watch incremental).
  - No CI (GitHub Actions): Use `npx vitest run` (execução única, paralela e otimizada).

