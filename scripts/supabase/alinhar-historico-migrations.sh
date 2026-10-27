#!/usr/bin/env bash
# Alinha o histórico de migrations do banco remoto com supabase/migrations/.
#
# Uso único, na transição de "migrations coladas no SQL Editor" para `supabase db push`.
# Marca como JÁ APLICADAS (sem executá-las) as migrations locais até a versão informada,
# para que o primeiro `db push` não tente reexecutá-las.
#
# Pré-requisitos: Node 20+, `npx supabase login` feito, e confirmação de que TODAS as
# migrations até <ultima_versao_aplicada> já foram executadas no banco de destino.
#
# Uso:
#   SUPABASE_PROJECT_REF=<ref> scripts/supabase/alinhar-historico-migrations.sh <ultima_versao_aplicada>
#   ex.: SUPABASE_PROJECT_REF=abcd1234 scripts/supabase/alinhar-historico-migrations.sh 20261026030000
#
# Guia completo: docs/banco-de-dados/migrations.md#transição-para-supabase-db-push
set -euo pipefail

SUPABASE="npx -y supabase@2.122.0"
ULTIMA_VERSAO="${1:?Informe a última versão já aplicada no banco (ex.: 20261026030000)}"
: "${SUPABASE_PROJECT_REF:?Defina SUPABASE_PROJECT_REF}"

cd "$(dirname "$0")/../.."

VERSOES=()
for f in supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  if [[ "$v" < "$ULTIMA_VERSAO" || "$v" == "$ULTIMA_VERSAO" ]]; then VERSOES+=("$v"); fi
done

echo "Vinculando ao projeto $SUPABASE_PROJECT_REF..."
$SUPABASE link --project-ref "$SUPABASE_PROJECT_REF"

echo
echo "Histórico ATUAL (coluna Remote vazia = não registrada no banco):"
$SUPABASE migration list

echo
echo "Serão marcadas como aplicadas (SEM executar SQL) ${#VERSOES[@]} migrations:"
printf '  %s\n' "${VERSOES[@]}"
echo
echo "Se a lista acima mostrou versões remotas antigas que não existem mais localmente"
echo "(ex.: 20261024), elas devem ser marcadas como revertidas depois:"
echo "  $SUPABASE migration repair --status reverted <versao_antiga>"
echo
read -r -p "Confirma que TODAS essas migrations já foram executadas neste banco? Digite SIM: " resposta
[[ "$resposta" == "SIM" ]] || { echo "Cancelado."; exit 1; }

$SUPABASE migration repair --status applied "${VERSOES[@]}"

echo
echo "Histórico DEPOIS:"
$SUPABASE migration list
echo
echo "Confira com: $SUPABASE db push --dry-run   (deve informar que o banco está atualizado)"
