---
version: 1.0
updatedAt: 2026-11-04
title: "Navegação, Menus, Janelas e Arquitetura da Informação"
summary: "Padrões de navegação, menus, janelas e diálogos, e os métodos de arquitetura da informação por trás deles, como card sorting e tree testing."
---
## Objetivos de Aprendizagem

- Separar arquitetura da informação (o que vai onde e como se chama) de controles de navegação.
- Relatar o que os estudos de amplitude e profundidade mediram e explicar por que a "regra dos três cliques" não é regra de design.
- Usar a evidência sobre navegação oculta e visível sem esticá-la.
- Escolher entre diálogo modal e não modal e descrever como eles diferem em um navegador real.
- Dizer o que card sorting e tree testing produzem e analisar um pequeno conjunto de dados de cada um.

## Contexto e Motivação

`prototyping-fidelity-sketch-wireframe-mockup-prototype` pergunta qual dimensão precisa ser real. Na navegação, costuma ser as palavras e a hierarquia, e isso se testa sem layout nenhum.

Falhas de encontrabilidade têm duas causas comuns. As pessoas podem não ver o controle, ou podem vê-lo e não entender para onde ele leva. O estudo de Pernice e Budiu, mais abaixo, trata da primeira causa, e card sorting e tree testing tratam da segunda. Trocar o componente de menu não conserta uma hierarquia confusa, e renomear uma hierarquia não conserta um menu que ninguém abre.

## Teoria Central

### Estrutura e controles

**Arquitetura da informação** é a estrutura do conteúdo: as categorias, seus rótulos e seu aninhamento. **Navegação** é o conjunto de elementos de interface que expõem essa estrutura, como barra superior, barra lateral, breadcrumbs ou menu. Uma mesma arquitetura pode ser apresentada por vários controles.

As pessoas escolhem um caminho prevendo o que há por trás de um rótulo. Essa previsão costuma ser chamada de **information scent** (faro de informação). Scent forte permite julgar o destino sem visitá-lo.

### Amplitude contra profundidade

Um conjunto fixo de itens pode ser organizado de forma larga e rasa ou estreita e profunda. Larson e Czerwinski resumem o estudo de D. Miller, em que quatro estruturas continham 64 itens ($2^6$, $4^3$, $8^2$ e $64^1$) e $8^2$ deu a aquisição mais rápida e o menor número de erros. Também resumem Snowberry et al., que constataram que a memória de curto prazo não previa o desempenho, enquanto a varredura visual previa. Os pré-testes de memória e varredura do próprio estudo deles não previram nada de forma confiável. Isso importa porque "sete mais ou menos dois" é uma afirmação sobre memória de curto prazo, não um limite de itens de menu, e menus são mais varridos do que memorizados. Laubheimer (2019, NN/g) lista "no more than 7 main-navigation categories" ao lado da regra dos três cliques como mito sem respaldo em dados.

O experimento de Larson e Czerwinski usou 19 usuários experientes de web, três estruturas de 512 itens de último nível construídas a partir da Encarta e tarefas de busca em 128 itens comuns às três.

| Estrutura | Tempo médio (DP) | Time-outs em 5 min | Votos de melhor |
|---|---|---|---|
| 16×32 | 36 s (16) | 2 | 2 de 19 |
| 32×16 | 46 s (26) | 3 | 11 de 19 |
| 8×8×8 | 58 s (23) | 9 | 6 de 19 |

O efeito da hierarquia foi significativo ($F(2,36)=6.34$, $p<.01$). A estrutura 8×8×8 foi significativamente mais lenta que as outras duas, e 16×32 e 32×16 não diferiram significativamente. Portanto, neste experimento a profundidade adicional prejudicou, e a opção mais larga também não venceu: sua média foi mais lenta, embora sem confiabilidade estatística. A preferência também discordou do desempenho, já que a maioria votou numa estrutura que não era a mais rápida em média. Os autores apontam uma fraqueza: um editor construiu as categorias, e elas não foram testadas com usuários. São 19 pessoas buscando em uma enciclopédia, então leia o resultado como direção, não como fórmula.

### A regra dos três cliques

A regra diz que nenhuma página deve ficar a mais de três cliques de distância. Laubheimer (2019) localiza a referência publicada mais antiga que encontrou em *Taking Your Talent to the Web* (2001), de Zeldman, que não oferece dados para ela.

Porter (2003) é a medição mais citada. Usando um estudo com 44 usuários em 620 tarefas e mais de 8.000 cliques, ele relata ausência de correlação entre o número de cliques e o sucesso em achar o conteúdo. Os usuários não tinham maior probabilidade de desistir depois de três cliques do que depois de 12. Tarefas bem e malsucedidas tiveram a mesma distribuição de comprimentos, e a parcela de usuários insatisfeitos ficou entre 46% e 61% em todos os comprimentos. Alguns usuários chegaram a 25 páginas.

É um artigo de consultoria sem detalhe estatístico, sobre tarefas de busca de informação, e não mostra que cliques são de graça. A conclusão de Porter é que o que incomoda os usuários é não encontrar o que procuram, e os cliques são o sintoma que eles nomeiam. A alternativa de Laubheimer é scent forte, orientação clara e tempos de carga curtos.

### Padrões de navegação

Pernice e Budiu (2016, NN/g) mediram navegação oculta (atrás de um ícone como o hambúrguer), visível e combinada (parte de cada). O estudo foi um teste remoto com 179 participantes no Reino Unido, 99 no desktop e 80 em celulares, que fizeram 2 tarefas em cada um de 6 sites reais.

| Métrica | Desktop | Celular |
|---|---|---|
| Usou a navegação, oculta | 27% | 57% |
| Usou a navegação, visível | 48% | não testado |
| Usou a navegação, combinada | 50% | 86% |
| Mais lento com navegação oculta | pelo menos 39% | 15% |

Valem três limites. A navegação visível não foi testada em celulares. O tipo de navegação era uma propriedade de cada site real, não foi atribuído ao acaso, então diferenças entre sites entram na conta. E os autores notam que não clicar num menu pode significar que a pessoa achou algo melhor. Os autores concluem que esconder a navegação degrada mais a experiência no desktop do que no celular, e no desktop há espaço para mostrá-la.

### Menus no código

O menu de navegação de um site é um conjunto de links. Um menu de aplicação é um widget de comandos, como num editor de desktop, e o ARIA tem os papéis `menu` e `menubar` para ele. O exemplo de navegação de site do WAI-ARIA Authoring Practices evita o papel `menu`, porque a tecnologia assistiva espera dele uma funcionalidade complexa de que a navegação típica não precisa. Ele usa botões de disclosure que mostram e escondem listas de links, e avisa que o código é ilustrativo e precisa ser testado com tecnologia assistiva.

### Janelas e diálogos

Fessenden (2017, NN/g) define **modo** como um estado em que a mesma entrada pode ter resultados diferentes. Caps Lock é o caso cotidiano. Um **diálogo modal** coloca o sistema num modo especial: desativa o conteúdo principal até o usuário responder. Um diálogo **não modal** mantém o conteúdo principal utilizável. O WAI-ARIA Authoring Practices afirma: "Windows under a modal dialog are inert."

Fessenden lista os custos da modalidade, como trabalho interrompido e contexto perdido, e reserva diálogos modais para avisos importantes, como quando se pode perder trabalho ou quando uma ação não pode ser desfeita. Isso é orientação fundamentada, e o artigo não relata comparação controlada.

### Card sorting e tree testing

Num **card sort**, os participantes agrupam cartões rotulados do jeito que faz sentido para eles (Tankala e Sherwin 2024, NN/g). Num sort aberto eles inventam os grupos, num fechado as categorias são predefinidas, e um híbrido mistura os dois. Num **tree test**, os participantes veem só a hierarquia nua, sem layout nem conteúdo, e precisam achar onde mora um item dado (Laubheimer 2023, NN/g). Laubheimer chama o card sorting de generativo e o tree testing de avaliativo, e avisa que iniciantes muitas vezes fazem um sort quando precisam de um tree test.

| | Card sort | Tree test |
|---|---|---|
| Pergunta | Como as pessoas agrupam este conteúdo? | As pessoas acham coisas nesta árvore? |
| Entrada | Cerca de 30 a 50 cartões | Árvore completa, tarefas, respostas corretas |
| Saída | Matriz de similaridade, dendrograma, nomes de grupos | Sucesso por tarefa, outras categorias escolhidas, tempo, directness |
| Não consegue dizer | Se as pessoas acham alguma coisa | Por quê, na forma não moderada, ou que árvore construir no lugar |

**Tamanho de amostra.** Nielsen (2004) relata o estudo de Tullis e Wood: 168 pessoas ordenaram cartões, e subconjuntos aleatórios foram comparados com o resultado completo. A correlação dos escores de similaridade foi 0,75 com 5 usuários, 0,90 com 15, 0,93 com 20, 0,95 com 30 e 0,98 com 60. Tullis e Wood recomendaram 20 a 30 usuários, e Nielsen 15, com os mesmos dados. Esses números vêm de um único estudo e medem concordância com a amostra grande, não a qualidade da arquitetura resultante.

## Exemplos Resolvidos

### Exemplo 1: dos cartões à matriz de similaridade

Os seis sorts abaixo são inventados para que a conta possa ser acompanhada à mão. Não são observações. Cartões: T Mensalidade, S Bolsas, C Catálogo de disciplinas, E Calendário de provas, L Horário da biblioteca, M Mapa do campus.

```text
P1  TS | CE | LM        P4  TS | CE | LM
P2  TS | CEL | M        P5  TS | CE | L | M
P3  TSE | C | LM        P6  TSC | E | LM
```

Similaridade é a parcela de participantes que colocou o par junto. C e E dividem uma pilha para P1, P2, P4 e P5, então $4/6=0.67$.

```text
     T     S     C     E     L     M
T  1.00  1.00  0.17  0.17  0.00  0.00
S  1.00  1.00  0.17  0.17  0.00  0.00
C  0.17  0.17  1.00  0.67  0.17  0.00
E  0.17  0.17  0.67  1.00  0.17  0.00
L  0.00  0.00  0.17  0.17  1.00  0.67
M  0.00  0.00  0.00  0.00  0.67  1.00
```

O agrupamento por ligação média sobre $1-\text{similaridade}$ (`scipy.cluster.hierarchy.linkage`, método `average`, SciPy 1.18.1) une T+S na distância 0, C+E e L+M em 0,333, depois {T,S}+{C,E} em 0,833 e tudo em 0,958. O dendrograma sugere três grupos. Ele não fornece rótulos, e "T+S" ainda não é um item de menu.

### Exemplo 2: testando duas árvores

A partir desse sort, uma equipe rascunha duas árvores. A árvore A tem Dinheiro, Acadêmico, Campus. A árvore B tem Custos, Disciplinas, Calendário, Campus. As contagens abaixo são inventadas para mostrar a análise, com 40 participantes diferentes por árvore (desenho entre sujeitos, como aconselha Laubheimer). Tarefa 1: achar o custo do próximo semestre. Tarefa 2: achar a data da sua prova final.

```text
tree task  success       95% Wilson        direct
A    1     31/40  0.775  [0.625, 0.877]    22/40  0.550
B    1     24/40  0.600  [0.446, 0.737]    20/40  0.500
A    2     18/40  0.450  [0.307, 0.602]     9/40  0.225
B    2     33/40  0.825  [0.681, 0.913]    29/40  0.725
```

O teste exato de Fisher dá $p=.147$ para a Tarefa 1 e $p=.00096$ para a Tarefa 2. Nesses dados inventados, a vantagem de A na Tarefa 1 pode ser ruído, enquanto a de B na Tarefa 2 não é. A árvore B vence essa tarefa mesmo se afastando dos três grupos do sort, o que mostra por que a saída de um sort é insumo para uma árvore, e não a árvore. A baixa directness da árvore A na Tarefa 2 é a próxima coisa a investigar, já que num estudo real significaria que as pessoas vagaram antes de decidir.

### Exemplo 3: a regra contra os dados de Larson

Conte uma seleção por nível para chegar a um item de último nível: três em 8×8×8 e duas em qualquer estrutura de dois níveis.

```text
estrutura  folhas  cliques minimos  obedece a regra  tempo medio
16×32      512     2                sim              36 s
32×16      512     2                sim              46 s
8×8×8      512     3                sim              58 s
```

As três obedecem à regra, então ela não consegue separá-las, e mesmo assim 8×8×8 foi a mais lenta e teve 9 dos 14 time-outs. A comparação é de caminhos mínimos, e uma busca real pode levar muitos mais.

### Exemplo 4: comportamento modal no navegador

Dois diálogos foram abertos em Chrome 156 com `<dialog>`, um com `show()` e outro com `showModal()`. Um clique real do mouse caiu num botão atrás do diálogo, e depois se pressionou Esc.

```text
metodo       clique chegou ao botao   ainda aberto depois do Esc
show()       sim                      sim
showModal()  nao                      nao
```

`showModal()` deixa o resto da página inerte e trata o Esc sem código extra, como a MDN documenta. Use a forma modal para "Excluir este projeto? Isso não pode ser desfeito." Use a não modal para um painel de localizar e substituir, em que o usuário precisa continuar lendo e editando o documento atrás dele.

## Equívocos Comuns e Armadilhas

- **"Tudo precisa estar a três cliques."** Nenhum dado publicado sustenta o número, e o Exemplo 3 mostra que ele não separa estruturas com tempos medidos diferentes.
- **"Menus devem ter no máximo sete itens."** Isso aplica mal um resultado de memória de curto prazo. A estrutura mais rápida de Larson tinha 16 itens no topo.
- **"Mais largo é sempre melhor."** A estrutura mais plana perdeu nos dois estudos acima: $8^2$ venceu $64^1$ no de D. Miller, e 32×16 teve média mais lenta que 16×32 no de Larson. Estruturas muito profundas também foram mal.
- **"O card sort nos dá a arquitetura."** Laubheimer (2023) diz que ele não costuma produzir o esquema exato a seguir. As pessoas criam pilhas genéricas que evitariam num menu real.
- **"O tree test passou, então a navegação está boa."** Ele testa só a hierarquia, sem layout, busca ou conteúdo das páginas. Um rótulo que funciona na árvore ainda pode ficar atrás de um menu que ninguém abre.
- **"Menu hambúrguer é sempre errado."** A evidência favorece mostrar a navegação onde há espaço. No celular, o estudo só comparou oculta com combinada, então não mostra que a navegação visível caberia.

## Resumo

Arquitetura da informação é a estrutura e seus rótulos, e navegação é como a interface os expõe. Nos estudos de menus e web revisados aqui, estruturas muito profundas prejudicaram a busca e a mais larga não venceu automaticamente, e nem "três cliques" nem "sete itens" se sustentam: o primeiro não tem dados de apoio, e o segundo aplica mal um resultado de memória. A navegação oculta reduziu o uso e deixou tarefas mais lentas num estudo com 179 pessoas, mais no desktop. Um diálogo modal torna todo o resto inerte, então reserve-o para decisões que merecem a interrupção. O card sorting gera agrupamentos, com uma matriz de similaridade como saída, e o tree testing avalia uma hierarquia, com sucesso e directness por tarefa como saída.

## Documentation Links

- [Larson, Czerwinski (1998): Web Page Design](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/chi98_webdesign.pdf): o experimento de amplitude e profundidade com 512 itens e sua revisão de estudos de menus.
- [Porter (2003): Testing the Three-Click Rule](https://articles.centercentre.com/three_click_rule/): 44 usuários, 620 tarefas, contagem de cliques contra sucesso e satisfação.
- [Laubheimer (2019): The 3-Click Rule](https://www.nngroup.com/articles/3-click-rule/): origem da regra e práticas melhores.
- [Pernice, Budiu (2016): Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/): resultados sobre navegação oculta, visível e combinada.
- [Tankala, Sherwin (2024): Card Sorting](https://www.nngroup.com/articles/card-sorting-definition/): definição, variações, análise e limites.
- [Laubheimer (2023): Tree Testing](https://www.nngroup.com/articles/tree-testing/): método, métricas e contraste com card sorting.
- [Nielsen (2004): Card Sorting, How Many Users to Test](https://www.nngroup.com/articles/card-sorting-how-many-users-to-test/): relato do estudo de subamostragem de Tullis e Wood.
- [Fessenden (2017): Modal and Nonmodal Dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/): definições, custos e diretrizes.
- [WAI-ARIA APG: Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): conteúdo inerte e comportamento de teclado.
- [WAI-ARIA APG: Disclosure Navigation Menu](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/): navegação de site sem o papel menu.
- [MDN: The dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog): `show()`, `showModal()` e comportamento de fechamento.
