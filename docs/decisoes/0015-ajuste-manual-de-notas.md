# 0015. Ajuste manual de notas como RPC marcada, não como UPDATE direto

- **Status**: Aceito
- **Data**: 2026-11-06

## Contexto

O sistema não tinha nenhum mecanismo de ajuste de nota: nenhuma RPC, nenhuma coluna, nenhuma tela. Mas a
necessidade existe na feira — avaliador que digitou errado, ficha em papel de quem ficou sem acesso ao
celular, decisão de comissão de recurso, penalidade por regulamento.

Sem caminho oficial, o ajuste acontecia pelo caminho que existia: `UPDATE` direto pela API REST, permitido
pela policy `FOR ALL` do Admin. Esse caminho não valida escala, não recalcula a nota a partir das respostas,
deixa `nota_final` inconsistente com `respostas_avaliacao` e não deixa rastro. Pior: numa auditoria, um
ajuste legítimo e uma adulteração ficam **indistinguíveis**.

## Decisão

Quatro RPCs oficiais, restritas ao Admin, com motivo opcional registrado na trilha, e **cada uma marca o
registro que alterou**:

| Ação | Marca |
|---|---|
| `admin_corrigir_respostas_avaliacao` | `avaliacoes.ajuste_tipo = 'respostas_corrigidas'` |
| `admin_lancar_avaliacao` | `avaliacoes.ajuste_tipo = 'lancada_pelo_admin'` |
| `admin_arbitrar_nota_final` | `avaliacoes.ajuste_tipo = 'nota_arbitrada'` |
| `admin_ajustar_media_projeto` | `projetos.ajuste_media` ≠ 0 |

A validação é a mesma do envio normal onde faz sentido (escala, conjunto completo de respostas,
questionário do projeto, um avaliador por projeto); cota cheia passa só com confirmação explícita, e o
excesso fica marcado. Trava, check-in e conflito institucional **não** são exigidos: são justamente as
condições que faltam no caso excepcional que motivou o ajuste.

A conferência de notas trata **nota arbitrada** como achado *informativo* — a conta não fecha por desenho,
e o motivo está ali. Nota que não fecha **sem** marca de ajuste continua sendo achado **grave**.

A média do projeto passa a ser exposta aberta: `media_geral + ajuste_media = media_final`, e o `RANK()` do
pódio ordena pela média final.

## Consequências

- O ajuste necessário deixa de ser invisível: fica validado, recalculado pela fórmula oficial quando cabe,
  e marcado em tela, no CSV e na folha de conferência.
- A comissão tem uma lista fechada de ajustes do evento (achado C12) para conferir antes de homologar.
- Toda leitura de média precisa expor as três colunas, ou a conferência C9 acusa divergência entre telas —
  é a trava que mantém Classificação e Relatórios de acordo.
- `ajuste_tipo` vira uma coluna que toda consulta de nota pode querer: o selo custa uma coluna, e o detalhe
  completo fica na trilha.
- Motivo é opcional por decisão de operação. A tela pede, a folha mostra "não informado" quando falta.

## Alternativas consideradas

- **Não ter ajuste manual**: era o estado anterior, e não impedia o ajuste — só o empurrava para o `UPDATE`
  direto, sem validação e sem rastro.
- **Motivo obrigatório**: recusado para não travar a correção no meio da feira; a folha de conferência
  expõe a ausência do motivo, o que cria a pressão certa sem bloquear.
- **Apagar e reenviar a avaliação**: destruiria o histórico e contraria o soft delete do
  [ADR 0004](0004-soft-delete-de-avaliacoes-via-rpc.md).
