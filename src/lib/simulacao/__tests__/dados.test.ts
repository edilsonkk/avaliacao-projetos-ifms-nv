// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  PREFIXO_EVENTO_SIMULACAO,
  DOMINIO_SIMULACAO,
  FUSO_EVENTO,
  CAMPI,
  MODALIDADES,
  AREAS,
  CRITERIOS_TECNICOS,
  CRITERIOS_VOTO_POPULAR,
  normalizar,
  agoraNoFusoDoEvento,
} from '@/lib/simulacao/dados';

describe('constantes de identificação da simulação', () => {
  it('usa o mesmo prefixo de evento do script de semeadura', () => {
    // Assert — é o que faz `npm run local:semear -- --limpar` reconhecer o que a interface criou
    expect(PREFIXO_EVENTO_SIMULACAO).toBe('Simulação de Carga');
  });

  it('usa um domínio reservado, que nunca entrega e-mail a ninguém', () => {
    // Assert
    expect(DOMINIO_SIMULACAO).toBe('simulacao.invalid');
  });

  it('declara o fuso do evento, não o do navegador', () => {
    // Assert
    expect(FUSO_EVENTO).toBe('America/Campo_Grande');
  });
});

describe('catálogos fictícios', () => {
  it('traz campus, modalidade com nível e área para montar o evento', () => {
    // Assert
    expect(CAMPI.length).toBeGreaterThan(1);
    expect(AREAS.length).toBeGreaterThan(1);
    expect(MODALIDADES.every(([nome, codigo, nivel]) => !!nome && !!codigo && !!nivel)).toBe(true);
  });

  it('dá pesos diferentes aos critérios técnicos, porque a nota final é média ponderada', () => {
    // Act
    const pesos = new Set(CRITERIOS_TECNICOS.map(([, peso]) => peso));

    // Assert
    expect(CRITERIOS_TECNICOS.length).toBeGreaterThan(1);
    expect(pesos.size).toBeGreaterThan(1);
    expect(CRITERIOS_TECNICOS.every(([texto, peso]) => !!texto && peso > 0)).toBe(true);
  });

  it('tem critérios próprios para o voto popular', () => {
    // Assert
    expect(CRITERIOS_VOTO_POPULAR.length).toBeGreaterThan(0);
    expect(CRITERIOS_VOTO_POPULAR.every(([texto, peso]) => !!texto && peso > 0)).toBe(true);
  });
});

describe('normalizar', () => {
  it('tira acento e sobe para caixa alta, como a coluna normalizada dos catálogos', () => {
    // Arrange / Act / Assert
    expect(normalizar('  Três Lagoas ')).toBe('TRES LAGOAS');
    expect(normalizar('Ponta Porã')).toBe('PONTA PORA');
  });
});

describe('agoraNoFusoDoEvento', () => {
  it('devolve a data do fuso do evento, não a do processo', () => {
    // Arrange — 24/11/2026 às 02:30 UTC é ainda dia 23 em Campo Grande (UTC-4)
    const referencia = new Date('2026-11-24T02:30:00Z');

    // Act
    const { data, hora } = agoraNoFusoDoEvento(referencia);

    // Assert — tomar a data em UTC deixaria a janela de avaliação no dia errado
    expect(data).toBe('2026-11-23');
    expect(hora).toBe('22:30:00');
  });

  it('não depende do fuso do processo para decidir o dia', () => {
    // Arrange — mesmo instante, lido com TZ do processo em dois extremos
    const referencia = new Date('2026-11-24T12:00:00Z');
    const tzOriginal = process.env.TZ;

    // Act
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
    const comTzAdiantado = agoraNoFusoDoEvento(referencia);
    process.env.TZ = 'Etc/GMT+12'; // UTC-12
    const comTzAtrasado = agoraNoFusoDoEvento(referencia);
    process.env.TZ = tzOriginal;

    // Assert
    expect(comTzAdiantado).toEqual(comTzAtrasado);
    expect(comTzAdiantado.data).toBe('2026-11-24');
  });

  it('formata data e hora no padrão que as colunas do evento esperam', () => {
    // Act
    const { data, hora } = agoraNoFusoDoEvento();

    // Assert
    expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hora).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
