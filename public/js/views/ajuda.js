import { h, mount, pageHead } from '../dom.js';
import { icon } from '../icons.js';

// Guia da equipe: capacitação dos funcionários no uso da ferramenta (ODS 8.3 e 8.2:
// pequenos negócios mais produtivos com tecnologia e qualificação).
const STEPS = [
  {
    iconName: 'plusCircle',
    title: 'Chegou mercadoria? Registre a entrada',
    text: 'Em "Nova entrada", escolha o produto, informe a quantidade e a data de validade. Se o produto chegou com validades diferentes, faça uma entrada para cada data.',
  },
  {
    iconName: 'camera',
    title: 'Fotografe a etiqueta de validade',
    text: 'A foto da data impressa na embalagem evita erro de digitação e serve de comprovante. No celular, o botão já abre a câmera.',
  },
  {
    iconName: 'dashboard',
    title: 'Comece o dia pelo Painel',
    text: 'O painel mostra o que já venceu e o que vence nos próximos 7 e 15 dias. Em "Vencimentos" dá para buscar por 5, 10, 30 dias ou qualquer número.',
  },
  {
    iconName: 'percent',
    title: 'Vai vencer? Faça promoção',
    text: 'Use o botão "Promover" com alguns dias de antecedência. Vender mais barato é melhor do que jogar fora: o valor vendido em promoção aparece como recuperado.',
  },
  {
    iconName: 'cart',
    title: 'Registre o que vendeu',
    text: 'Ao vender um lote (ou parte dele), use "Vendeu" para manter o estoque certo.',
  },
  {
    iconName: 'ban',
    title: 'Não teve jeito? Registre a perda',
    text: 'Use "Perda" com o motivo (vencido, estragado, embalagem danificada). É esse registro que mostra ao dono onde o dinheiro está indo embora.',
  },
];

const TIPS = [
  'Produtos que vencem primeiro vão para a frente da prateleira.',
  'Hortifrúti: use os atalhos +3 e +7 dias na data de validade.',
  'Confira o painel no começo e no fim do expediente.',
  'Dúvidas ou erro em algum lote? Fale com o administrador; ele pode corrigir ou excluir.',
];

export function render(main) {
  mount(
    main,
    pageHead('Guia da equipe', 'Como usar o sistema no dia a dia em 6 passos.'),
    h(
      'div',
      { class: 'callout' },
      h('span', { class: 'ods-badge' }, 'ODS 8'),
      h(
        'div',
        null,
        h('strong', null, 'Por que isso importa'),
        h('p', { class: 'small muted' }, 'Desperdício é prejuízo direto para o pequeno comércio. Cada produto vendido antes de vencer ajuda a manter o negócio saudável e os empregos da equipe.'),
      ),
    ),
    h(
      'ol',
      { class: 'guide section-gap' },
      STEPS.map((s, i) =>
        h(
          'li',
          { class: 'card card-pad guide-step' },
          h('span', { class: 'guide-num' }, i + 1),
          h('span', { class: 'kpi-icon guide-icon' }, icon(s.iconName, 20)),
          h('div', null, h('h3', null, s.title), h('p', { class: 'small muted' }, s.text)),
        ),
      ),
    ),
    h('section', { class: 'card card-pad stack section-gap' }, h('h2', null, 'Dicas rápidas'), h('ul', { class: 'tips' }, TIPS.map((t) => h('li', null, t)))),
  );
}
