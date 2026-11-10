---
version: 1.0
updatedAt: 2026-11-04
title: "Acessibilidade e WCAG"
summary: "Os quatro princípios e os níveis de conformidade da WCAG, marcação semântica, acesso por teclado e teste com tecnologia assistiva, na versão publicada vigente da norma."
---
## Objetivos de Aprendizagem

- Nomear a versão publicada vigente da WCAG, e o status da WCAG 2.1 e do rascunho da WCAG 3.
- Citar critérios de sucesso por número e nível, e dizer o que a WCAG 2.2 acrescentou e removeu em relação à 2.1.
- Explicar por que semântica nativa e operação por teclado vêm antes de ARIA.
- Rodar o axe-core numa página e ler seus três grupos de resultado: violations, incomplete e passes.
- Dizer o que aprovação automática, revisão manual, teste com tecnologia assistiva e teste com pessoas com deficiência conseguem estabelecer.

## Contexto e Motivação

`semiotic-engineering-communicability-and-the-designers-message` trata a interface como mensagem do designer para o usuário. Acessibilidade pergunta se essa mensagem chega a quem não vê a tela, não usa mouse ou precisa de texto maior do que o layout previa. `color-typography-and-icons` calculou uma exigência, a razão de contraste. Esta lição a coloca dentro da norma inteira e depois pergunta o que um teste verde prova.

## Teoria Central

### Qual documento é a norma

Em novembro de 2026, a versão publicada vigente é a **WCAG 2.2**, W3C Recommendation publicada em 5 de outubro de 2023 e atualizada em 12 de dezembro de 2024. A visão geral do W3C não lista Recommendation posterior. Ela também é norma ISO: o W3C diz que a ISO/IEC 40500:2025 "is exactly the same as the October 2023 version of WCAG 2.2." Três fatos de status evitam quase toda a confusão.

- A WCAG 2.2 "does not deprecate or supersede WCAG 2.1". Lei ou contrato que cita a 2.1 continua citando a 2.1, embora o Working Group recomende a 2.2 como novo alvo.
- A WCAG 2.2 é retrocompatível por projeto: conteúdo em conformidade com a 2.2 também está em conformidade com a 2.1 e a 2.0.
- **A WCAG 3 não é norma.** A publicação mais recente é um Working Draft de 10 de setembro de 2026, cuja seção de status diz que a publicação "does not imply endorsement by W3C and its Members." A introdução do W3C a chama de "an incomplete draft that will change" e não espera que seja norma concluída "for a few more years". Nada ali pode ser citado como exigência hoje.

### Estrutura e conformidade

A WCAG 2.2 tem quatro princípios (perceptível, operável, compreensível, robusto), 13 diretrizes e, contados no texto publicado, 86 critérios de sucesso ativos: 31 no Nível A, 24 no AA e 31 no AAA. Os critérios são a camada testável. Nível AA significa satisfazer todos os 55 de A e AA.

A conformidade tem cinco requisitos: um nível atendido por inteiro, páginas completas, processos completos, só usos de tecnologia com suporte de acessibilidade e não interferência. Duas consequências importam. Excluir parte de uma página impede a conformidade daquela página, e uma etapa reprovada num checkout reprova o processo. Suporte de acessibilidade significa que o modo de usar a tecnologia "has been tested for interoperability with users' assistive technology", então a tecnologia assistiva está escrita no próprio modelo de conformidade.

AAA não é alvo sensato para um site inteiro: a WCAG diz que "it is not possible to satisfy all Level AAA success criteria for some content". Ela também avisa que mesmo conteúdo AAA "will not be accessible to individuals with all types, degrees, or combinations of disability". Conformidade é piso.

### O que mudou da 2.1 para a 2.2

Nove critérios entraram e um saiu.

| Novo na 2.2 | Nível |
|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | AA |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA |
| 2.4.13 Focus Appearance | AAA |
| 2.5.7 Dragging Movements | AA |
| 2.5.8 Target Size (Minimum) | AA |
| 3.2.6 Consistent Help | A |
| 3.3.7 Redundant Entry | A |
| 3.3.8 Accessible Authentication (Minimum) | AA |
| 3.3.9 Accessible Authentication (Enhanced) | AAA |

**Removido: 4.1.1 Parsing (Nível A)**, agora marcado como "Obsolete and removed". Ele existia porque a tecnologia assistiva fazia o parsing do HTML por conta própria, e hoje depende do navegador. O FAQ do W3C acrescenta que o que reprovava no 4.1.1 reprova em outros critérios, como 1.3.1 ou 4.1.2. As versões antigas também receberam nota: a WCAG 2.1 e a 2.0 agora dizem que o 4.1.1 "should be considered as always satisfied for any content using HTML or XML", embora a WCAG 2.2 ainda avise que autores presos por política às versões antigas "may need to continue to test and report 4.1.1".

O critério AAA 2.5.5 Target Size passou a se chamar Target Size (Enhanced), e os novos critérios foram anexados ao fim de suas diretrizes, então a ordem dos números não implica mais a ordem dos níveis. Comparar os dois textos publicados não mostra nenhum outro critério mudando de nível ou de nome: o 2.4.7 Focus Visible continua AA.

### Marcação semântica e ARIA

Elementos nativos trazem papel, nome e comportamento de teclado. Um `<button>` recebe foco, ativa com Enter e Espaço e é exposto como botão. Um `<div onclick>` não recebe nada disso. Na prática, isso é o critério 4.1.2 Name, Role, Value (A) e o 1.3.1 Info and Relationships (A): o que o olho tira do layout também precisa existir na marcação.

ARIA pode mudar o que é exposto, e não muda mais nada. O guia de autoria do W3C abre com "No ARIA is better than Bad ARIA" e chama um papel de "promise": `role="button"` num `<div>` compromete o autor a escrever o comportamento de teclado à mão.

### Acesso por teclado

Os critérios centrais são 2.1.1 Keyboard (A), 2.1.2 No Keyboard Trap (A), 2.4.3 Focus Order (A), 2.4.7 Focus Visible (AA) e 2.4.11 Focus Not Obscured (Minimum) (AA). O teste não exige ferramenta: largue o mouse, percorra a página com Tab e ative tudo com Enter ou Espaço. O W3C observa que isso também atende emuladores de teclado, como software de entrada por voz e teclados na tela.

### Quatro tipos de verificação

| Verificação | Consegue estabelecer | Não consegue estabelecer |
|---|---|---|
| Regras automáticas (axe-core) | A presença de defeitos que uma regra detecta | Conformidade, ou que a página é usável |
| Revisão manual contra os critérios | Se cada critério é atendido, por julgamento humano | Como a tecnologia assistiva real se comporta, se não for testada |
| Teste com tecnologia assistiva | O que um par de leitor de tela e navegador expõe de fato | Que pessoas com deficiência fazem a tarefa |
| Teste com pessoas com deficiência | Se pessoas reais completam tarefas reais | Conformidade: usável para esses participantes não é todos os critérios atendidos |

Os números sobre automação precisam de denominador. O README do axe-core afirma encontrar automaticamente "on average 57% of WCAG issues", sem dar ali o método. O Government Digital Service do Reino Unido montou uma página com 143 falhas e rodou 10 ferramentas em 2017: 42 barreiras (29 por cento) escaparam de todas. A melhor ferramenta achou 37 por cento em erros e avisos, e outra chegou a 41 por cento contando pedidos de inspeção manual. Esses números medem coisas diferentes, um é parcela de problemas nos termos do fornecedor e o outro é parcela de barreiras plantadas numa página de teste, então um não corrige o outro, e a auditoria do GDS é datada. O resumo do W3C é a parte estável: "Web accessibility evaluation tools can not determine accessibility, they can only assist in doing so."

A varredura do WebAIM de fevereiro de 2026, com o WAVE, detectou falhas de WCAG 2 em 95,9 por cento de um milhão de home pages, puxadas por texto de baixo contraste, com 83,9 por cento. Só contam falhas detectáveis automaticamente, então o WebAIM conclui que a conformidade plena A/AA foi certamente menor que 4,1 por cento.

Teste com tecnologia assistiva é outra atividade, que ferramenta automática não simula: uma pessoa operando, por exemplo, NVDA, JAWS, VoiceOver ou TalkBack, ouvindo o que é anunciado durante uma tarefa. **Nenhum leitor de tela foi usado nos exemplos abaixo.** Eles mostram saída do axe-core, eventos de teclado enviados pelo Playwright e a árvore de acessibilidade do navegador. O W3C recomenda envolver pessoas com deficiência ao longo do projeto, e avisa tanto que esse envolvimento sozinho não determina se um site é acessível quanto que resultados de duas ou três pessoas não se generalizam.

## Exemplos Resolvidos

Todas as execuções usam axe-core 4.14.0 com opções padrão, injetado pelo Playwright no Chrome 156. As listagens são resumos compactos do resultado de `axe.run()`.

### Exemplo 1: uma página que o axe reprova

```html
<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div style="font-size:32px">Checkout</div>
  <img src="chart.svg">
  <p style="color:#777777;background:#ffffff">Your order ships in 3 days.</p>
  <input type="text" placeholder="Email">
  <button><svg width="16" height="16"><circle cx="8" cy="8" r="7"/></svg></button>
</body>
</html>
```

```text
violations 8
button-name [critical] wcag2a,wcag412 nodes=1
color-contrast [serious] wcag2aa,wcag143 nodes=1
document-title [serious] wcag2a,wcag242 nodes=1
html-has-lang [serious] wcag2a,wcag311 nodes=1
image-alt [critical] wcag2a,wcag111 nodes=1
landmark-one-main [moderate] best-practice nodes=1
page-has-heading-one [moderate] best-practice nodes=1
region [moderate] best-practice nodes=4
incomplete 0
passes 9   inapplicable 75
```

Cinco violações têm critério de sucesso: 4.1.2, 1.4.3, 2.4.2, 3.1.1 e 1.1.1. As outras três são regras de boa prática, conselho e não falha de WCAG, então "8 falhas de WCAG" estaria errado. `#777777` é o cinza de 4,48:1 de `color-typography-and-icons`.

Falta uma linha: o input não tem `<label>`, e mesmo assim `label` está entre as aprovações, porque a verificação `non-empty-placeholder` do axe aceitou o placeholder como nome. Para a regra existe um nome, mas ele some assim que a pessoa digita. A regra responde a uma pergunta mais estreita que a do designer.

### Exemplo 2: uma execução limpa com um defeito real

A segunda página corrige tudo isso: `lang`, título, `<main>`, `<h1>`, um `<label>` de verdade, `#767676` e `alt="chart"`. Ela também tem um controle de pagamento e uma promoção sobre gradiente:

```html
<p class="promo">Free returns this week</p>
<div class="pay" onclick="pay()">Pay now</div>
<p id="out" role="status"></p>
```

```text
violations 0
incomplete 1
color-contrast [serious] wcag2aa,wcag143 nodes=1
    .promo ["Element's background color could not be determined due to a background gradient"]
passes 26   inapplicable 64
```

Zero violações, e a página não pode ser paga pelo teclado. Numa execução real, Tab foi pressionado quatro vezes, depois Enter, depois o mouse clicou no controle.

```text
Tab sequence [ 'INPUT#email', 'BODY', 'INPUT#email', 'BODY' ]
after Enter, status= ""
after mouse click, status= "Paid"
```

O foco nunca chega ao controle, o que reprova o 2.1.1 (A) e, sem papel exposto, o 4.1.2 (A). A árvore de acessibilidade mostra o porquê, comparando `<button>` com o `<div>` numa página de teste, ambos com o texto Pay now:

```text
- main:
  - button "Pay now"
  - text: Pay now
```

Trocar o `<div>` por `<button>` dá isto, com Tab duas vezes e depois Enter:

```text
violations 0
incomplete 1
passes 27   inapplicable 63
Tab sequence [ 'INPUT#email', 'BUTTON' ]
after Enter, status= "Paid"
```

O axe dá 0 violações para as duas páginas, então seu veredito não separa a quebrada da corrigida. Outros dois defeitos sobrevivem à execução limpa. `alt="chart"` satisfaz a regra `image-alt` sem dizer nada dos dados, e o 1.1.1 pede uma alternativa em texto com propósito equivalente. E o item `incomplete` é uma pergunta para uma pessoa: na ponta clara do gradiente, branco sobre `#88CCFF` dá 1,73:1.

### Exemplo 3: quanto da norma as regras tocam

Ler as tags do axe-core 4.14.0 dá 105 regras, das quais 90 rodam por padrão (sem contar as deprecated e experimental). Essas 90 citam 21 critérios distintos, 20 dos 55 de A e AA, mais um AAA. Algumas consequências:

- Nenhuma regra cita 2.4.7 Focus Visible, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order ou 1.4.11 Non-text Contrast.
- Dos critérios novos na 2.2, só o 2.5.8 tem regra, `target-size`, e ela vem desativada por padrão.
- As regras marcadas com 4.1.1 estão deprecated e desativadas, em linha com a remoção.
- Tag não significa cobertura. Três regras citam o 2.1.1, e o Exemplo 2 reprova no 2.1.1 com todas elas em silêncio.

Isso conta regras contra critérios, e não diz que fração dos defeitos reais é achada.

### Exemplo 4: lendo uma alegação

Tome a frase fictícia "Passamos no axe, logo estamos em conformidade com a WCAG 2.2 AA." O Exemplo 2 refuta a inferência. Uma versão defensável diz: "o axe-core 4.14.0 não relatou violações nestas 12 páginas nesta data, e um item precisa de revisão." Uma alegação de conformidade precisa do que a seção 5.3 lista (data, título e URI da diretriz, nível, páginas, tecnologias de que depende), e por trás dela uma revisão dos 55 critérios. Se um leitor de tela foi usado, diga qual, em qual navegador e para quais tarefas.

## Equívocos Comuns e Armadilhas

- **"Zero violações do axe significa acessível."** Significa que as regras ativas não acharam nada nos estados testados. O Exemplo 2 não pode ser pago pelo teclado.
- **"O axe mostra como violação tudo de que suspeita."** Casos incertos caem em `incomplete`, e um relatório que os esconde esconde trabalho.
- **"A WCAG 3 substitui a 2.2, então vamos esperar."** É rascunho, e o W3C diz que o jeito de se preparar é atender à WCAG 2.2 agora.
- **"A árvore de acessibilidade do navegador é teste com leitor de tela."** A árvore é uma entrada para a tecnologia assistiva, e não diz nada do que o usuário ouve ou consegue fazer.

## Resumo

A WCAG 2.2 é a versão publicada vigente, atualizada em dezembro de 2024, a 2.1 continua sendo norma existente e a WCAG 3 continua sendo Working Draft. Em relação à 2.1, ela acrescenta nove critérios e remove o 4.1.1 Parsing. O HTML nativo dá papel, nome e comportamento de teclado que ARIA só consegue descrever. Uma aprovação no axe-core diz que as regras ativas não acharam defeito no estado testado: não é conformidade, e a execução acima mostra uma página com zero violações que não se conclui pelo teclado. Regras automáticas, revisão manual, teste com tecnologia assistiva e teste com pessoas com deficiência respondem a perguntas diferentes, e um relatório tem de dizer quais foram feitos.

## Documentation Links

- [W3C (2024): Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/): os critérios normativos, os níveis, os requisitos de conformidade e a comparação com a 2.1.
- [W3C WAI: WCAG 2 Overview](https://www.w3.org/WAI/standards-guidelines/wcag/): versões, datas de publicação e a relação com a ISO.
- [W3C WAI: WCAG 2 FAQ](https://www.w3.org/WAI/standards-guidelines/wcag/faq/): por que o 4.1.1 Parsing ficou obsoleto, e as notas na 2.0 e na 2.1.
- [W3C (2026): WCAG 3.0 Working Draft](https://www.w3.org/TR/wcag-3.0/): o rascunho atual e sua seção de status.
- [W3C WAI: WCAG 3 Introduction](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/): o que é o rascunho e o cronograma esperado.
- [W3C WAI: ARIA Authoring Practices, Read Me First](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/): nenhum ARIA é melhor que ARIA ruim.
- [W3C WAI: Selecting Web Accessibility Evaluation Tools](https://www.w3.org/WAI/test-evaluate/tools/selecting/): o que as ferramentas conseguem e não conseguem fazer.
- [W3C WAI: Involving Users in Evaluating Web Accessibility](https://www.w3.org/WAI/test-evaluate/involving-users/): como trabalhar com pessoas com deficiência ao longo de um projeto.
- [axe-core on GitHub](https://github.com/dequelabs/axe-core): o motor de regras, seus grupos de resultado e a alegação de 57 por cento.
- [GDS (2017): What we found when we tested tools on the world's least-accessible webpage](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/): a auditoria de 10 ferramentas em 143 barreiras plantadas.
- [WebAIM (2026): The WebAIM Million](https://webaim.org/projects/million/): resultados automáticos de um milhão de home pages.
