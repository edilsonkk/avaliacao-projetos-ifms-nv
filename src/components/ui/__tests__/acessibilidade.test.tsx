import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Botao, Campo, CampoSelecao, Cartao, Estado, Modal, Selo, Tabela } from '@/components/ui';
import { esperarSemViolacoesDeAcessibilidade } from '@/test/axe';

/**
 * Auditoria automática (axe) dos componentes da base. Complementa os testes de
 * comportamento: pega rótulo faltando, papel errado e ARIA inválida que a asserção
 * manual não vê.
 */
describe('Acessibilidade dos componentes de interface', () => {
  it('não deve ter violação num formulário montado com os componentes da base', async () => {
    // Arrange / Act
    const { container } = render(
      <main>
        <h1>Cadastro de avaliador</h1>
        <Cartao titulo="Dados da pessoa" como="section" nivelTitulo={2}>
          <Campo rotulo="Nome completo" descricao="Como aparece no certificado." />
          <Campo rotulo="E-mail" type="email" erro="Informe um e-mail válido." />
          <CampoSelecao rotulo="Instituição">
            <option value="">Selecione</option>
            <option value="ifms">IFMS</option>
          </CampoSelecao>
          <Selo tom="sucesso">credenciado</Selo>
          <Botao larguraTotal>Salvar</Botao>
          <Botao aria-label="Remover" variante="fantasma" icone={<span>x</span>} />
        </Cartao>
        <Estado situacao="vazio" titulo="Nenhum projeto importado" />
      </main>,
    );

    // Assert
    await esperarSemViolacoesDeAcessibilidade(container);
  });

  it('não deve ter violação com o diálogo aberto', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <main>
        <h1>Configurações</h1>
        <Modal
          aberto
          aoFechar={() => {}}
          titulo="Configurações do evento"
          descricao="Valem para o evento ativo."
          acoes={<Botao>Salvar</Botao>}
        >
          <Campo rotulo="Nome do evento" />
        </Modal>
      </main>,
    );

    // Act
    await user.tab();

    // Assert: o diálogo vai para o body (portal), então a auditoria é do documento todo
    await esperarSemViolacoesDeAcessibilidade(document.body);
    expect(screen.getByRole('dialog', { name: 'Configurações do evento' })).toBeInTheDocument();
  });

  it('não deve ter violação numa tabela com cabeçalho e legenda', async () => {
    // Arrange / Act
    const { container } = render(
      <main>
        <h1>Projetos</h1>
        <Tabela legenda="Projetos do evento" colunas={['Código', 'Título']}>
          <tr>
            <td>FEI-001</td>
            <td>Projeto de teste</td>
          </tr>
        </Tabela>
      </main>,
    );

    // Assert
    await esperarSemViolacoesDeAcessibilidade(container);
  });
});
