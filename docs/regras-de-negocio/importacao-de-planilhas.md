# Importação de Planilhas e De-Para

Código: `src/lib/excel/excelUtils.ts`, `src/lib/parsers/`, `src/components/importacao/ModalDeParaMapping.tsx` e os
gestores de cada feature. Modelos estáticos: `public/modelos/`.

## Regras gerais

- Formatos aceitos: `.xls`, `.xlsx`, `.csv` (leitura com `exceljs`). O arquivo é validado antes
  (`validarArquivoPlanilha`).
- O botão é sempre `Importar (.xls/.xlsx/.csv)` e abre direto o seletor de arquivos.
- **Tudo em memória, um único envio**: parsear, validar e montar o payload no cliente e enviar com um
  `.upsert([...], { onConflict })`. Proibido gravar linha a linha.
- Cabeçalhos são reconhecidos sem diferenciar caixa e acentos.
- Parsers são funções puras em `src/lib/parsers/`, testadas em ambiente Node.
- Um console de logs retrátil mostra o andamento.

## Gestores e mapeamento

| Gestor | Tabelas | Colunas reconhecidas | Chave do upsert |
|---|---|---|---|
| `GestorProjetos` | `projetos` | Código, Título, Área Temática, Nível/Categoria/Modalidade, Instituição, Sigla, Estande, Corredor, Orientador, Estudantes, Fora da Competição | `id_evento, codigo_projeto` (constraint `uq_projetos_evento_codigo`) |
| `GestorAvaliadores` | RPC `admin_salvar_avaliadores` (uma chamada para a planilha toda) | nome, email, instituicao, sigla_instituicao, modalidades_bloqueadas, areas | `email` (sem diferenciar maiúsculas); e-mails de Admin/Staff são ignorados |
| `GestorStaff` | RPC `admin_salvar_staff` (uma chamada) | Nome, E-mail, Papel (`STAFF`/`MONITOR`) | `email` (sem diferenciar maiúsculas); e-mails de Admin/Avaliador são ignorados |
| `GestorInstituicoes` | RPC `admin_salvar_instituicoes` (uma chamada) | Nome / Instituição, Sigla, Câmpus | `(id_evento, nome_normalizado)` |
| `GestorModalidades` | `modalidades` | Código, Modalidade, Nível, Área Temática, Descrição | por evento |
| `GestorQuestionarios` | Preenche o formulário; grava por `admin_salvar_questionario` ao salvar | Pergunta/Critério, Lembrete/Descrição, Peso (padrão 1.0) | vinculado ao questionário |

### Importação de projetos

1. Exige evento ativo: sem ele, nada é gravado.
2. Instituições e modalidades que não batem exatamente abrem o De-Para (associar a uma existente ou cadastrar).
3. Referências novas (instituições, áreas temáticas, modalidades) são gravadas **num único insert por tabela**, já
   com `id_evento`, antes dos projetos.
4. Os projetos vão num único upsert por `(id_evento, codigo_projeto)`. Código com espaços nas pontas é aparado.
5. Código repetido na planilha: vale a última linha, e o console avisa. Projeto sem código é sempre criado de novo
   (o console avisa), então prefira sempre informar o código.
6. Reimportar atualiza título, estande, corredor, instituição, área, modalidade e "fora da competição", mas **não**
   mexe em check-in nem em "Topo da Fila".
7. Modalidade não encontrada deixa o projeto sem modalidade e aparece no console.

**Baixar Modelo (.xlsx)** está disponível em Projetos, Avaliadores e Modalidades.
- Projetos: colunas `codigo_projeto`, `titulo`, `estande`, `corredor`, `instituicao`, `sigla_instituicao`,
  `area_tematica`, `modalidade`, `fora_da_competicao`, com 3 linhas de exemplo. Arquivos fixos em
  `public/modelos/modelo_importacao_projetos.{xlsx,csv}`.
- Avaliadores: `modelo_importacao_avaliadores.xlsx` com `nome`, `email`, `instituicao`, `sigla_instituicao`,
  `modalidades_bloqueadas`, `areas`.

Na planilha de avaliadores, a coluna `areas` (ou `areas_avaliacao`, `area_tematica`) aceita vários valores separados
por vírgula, barra, traço, ponto e vírgula ou pipe.

## Auto-cadastro de entidades relacionadas

Na importação de projetos (e avaliadores), se a instituição, área temática ou modalidade informada não existir no
evento, ela é criada **uma vez** no lote, com `id_evento`, e o ID gerado é reutilizado para todas as linhas.

## Sanitização e fuzzy matching

`src/lib/parsers/fuzzyMatcher.ts`:

- `sanitizarTexto`: remove acentos (NFD), junta siglas com pontos (`I.F.M.S.` → `IFMS`), troca pontuação
  (`/ - _ ( ) ,`) por espaço, colapsa espaços e converte para MAIÚSCULAS.
- Similaridade: combinação de Levenshtein normalizado e **Token Sort Ratio** (ignora a ordem das palavras:
  `"Campus Campo Grande IFMS"` ≈ `"IFMS Campus Campo Grande"`).
- **Limiar: ≥ 85% (`0.85`)** para considerar candidato (`fuzzy`). Abaixo disso, o termo é `novo`.

## Tela De-Para (`ModalDeParaMapping`)

Usada nas importações de Projetos, Avaliadores e Modalidades.

- Se todos os termos têm correspondência **exata** (nome oficial, sigla ou alias), grava direto, sem interromper.
- Se houver termos `fuzzy` ou `novo`, abre o modal com: termo original, badge de confiança (ex.: `88% match`) e um
  seletor para vincular à sugestão, escolher outro registro ou `+ Cadastrar como Novo`.
- `Confirmar e Prosseguir com a Importação` salva os aliases aprendidos e grava o lote. `+ Cadastrar como Novo` cria a
  entidade com `id_evento`.

## Dicionário de aliases

Tabelas `instituicao_aliases` e `modalidade_aliases`. Cada confirmação no De-Para salva a variação escrita (upsert).
Na próxima importação, o termo é reconhecido como correspondência exata.

## Áreas temáticas (CNPq)

`src/lib/parsers/areasTematicasNormalizer.ts` converte texto livre para as grandes áreas do CNPq, em MAIÚSCULAS com
acentuação oficial:

1. CIÊNCIAS EXATAS E DA TERRA
2. CIÊNCIAS BIOLÓGICAS
3. ENGENHARIAS
4. CIÊNCIAS DA SAÚDE
5. CIÊNCIAS AGRÁRIAS
6. CIÊNCIAS SOCIAIS APLICADAS
7. CIÊNCIAS HUMANAS
8. LINGUÍSTICA, LETRAS E ARTES
9. MULTIDISCIPLINAR

Áreas fora da tabela: sem acentos, espaços colapsados, MAIÚSCULAS.

## Instituições

- Lista só as instituições do **evento ativo**: Instituição, Sigla e Câmpus, ordenáveis (também pelo teclado). Sem
  evento ativo, a tela avisa e não cadastra. O `nome_normalizado` não é exibido.
- `nome_normalizado` é calculado por trigger no banco (`fn_normalizar_nome`: minúsculas, sem acento, sem espaços nas
  pontas), o mesmo critério de Projetos, Avaliadores e autocadastro. A mesma escola escrita de outro jeito não
  duplica no evento.
- Cadastro e importação passam por `admin_salvar_instituicoes` (uma chamada): instituição já existente tem sigla e
  câmpus atualizados; sigla vazia fica vazia (não é inventada). Há modelo `modelo_importacao_instituicoes.xlsx`.
- **Excluir** pede confirmação e é recusado se houver projeto ou avaliador da instituição
  (`admin_excluir_instituicao`): sem a instituição, a regra de conflito de instituição deixaria de valer para eles.

## Modalidades e Níveis

Card no Bloco 2 (`GestorModalidades`), no layout canônico dos gestores: cadastro com código, nome, nível
(Fundamental, Médio, Médio/Técnico, Técnico, Superior, Geral), área temática e descrição; busca; ordenação em todas
as colunas; edição inline.

Testes: `src/lib/parsers/__tests__/`, `src/features/cadastros/__tests__/GestorModalidadesEDePara.test.tsx`,
`src/features/projetos/__tests__/`, `src/features/avaliadores/__tests__/GestorAvaliadores.test.tsx`,
`src/__tests__/integracao/AutoCadastroEAreasTematicasEvento.test.tsx`, `CotaEstritaEAutoCadastroDePara.test.tsx`.
