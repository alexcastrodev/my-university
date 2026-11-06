---
version: 1.0
updatedAt: 2026-11-04
title: "Computação Ubíqua e Interação Pós-WIMP"
summary: "A visão de computação ubíqua de Weiser e a interação pós-WIMP por toque, voz, gesto e consciência de contexto, com o que se confirmou e o que não se confirmou."
---
## Objetivos de Aprendizagem

- Dizer o que é WIMP, quem definiu pós-WIMP e em que esse termo difere das noncommand interfaces de Nielsen.
- Aplicar os quatro temas e as seis qualidades de trade-off da interação baseada em realidade a um design concreto.
- Separar o que se confirmou na visão de Weiser de 1991 do que não se confirmou, com fonte datada.
- Pesar a evidência sobre toque, voz, gesto e olhar pela data, pela população e pela tarefa.
- Calcular um espaçamento da WCAG e uma concordância de gestos, e dizer o que cada um omite.

## Contexto e Motivação

`internationalization-and-localization` levou a interface para outros locales. Esta lição a tira da mesa: para a mão, a cozinha, o carro, o headset. Duas narrativas enquadram isso: a computação ubíqua, do artigo de Mark Weiser de 1991, e a interação pós-WIMP, uma família de estilos definida pelo que deixa para trás.

As duas atraem leitura retroativa ("Weiser previu o smartphone") e vocabulário de marketing ("natural"). A evidência sobre modalidades envelhece rápido, então cada achado traz sua data.

## Teoria Central

### WIMP e os nomes do que veio depois

O artigo de Nielsen de 1993 sobre noncommand interfaces lista a geração "Windows, Icons, Menus, and a Pointing device". O nome que dá à geração seguinte se apoia em quem controla o diálogo. O conceito unificador, escreveu, é "the abandonment of the principle underlying all earlier interaction paradigms: that a dialogue has to be controlled by specific and precise commands issued by the user". Em vez disso, o computador faz inferências observando o usuário.

Pós-WIMP é outro tipo de termo. Jacob e colegas creditam a definição a van Dam: interfaces "containing at least one interaction technique not dependent on classical 2D widgets such as menus and icons". Essa definição trata de técnica e é ampla: um único swipe já conta. "Coloque um timer de dez minutos" é pós-WIMP por ela e, pelo princípio de Nielsen, segue sendo comando preciso do usuário.

### Interação baseada em realidade

Jacob et al. (CHI 2008) propõem a reality-based interaction (RBI), que amarra "a large subset" desses estilos, não todos. A tese é que eles se apoiam no que as pessoas já sabem do mundo não digital, o que muitas vezes estreita o golfo de execução de `mental-models-and-the-gulfs-of-execution-and-evaluation`.

| Tema | O que as pessoas já têm | Exemplo do artigo |
|---|---|---|
| Física ingênua | Senso comum sobre gravidade e inércia | Uma lista lançada segue rolando, "as if the list itself had mass" |
| Consciência e habilidades do corpo | Conhecer e coordenar o próprio corpo | Entrada com as duas mãos ou o corpo |
| Consciência e habilidades do ambiente | Orientação, navegação, manuseio de objetos | Guia que mostra o que há em volta |
| Consciência e habilidades sociais | Perceber os outros e trabalhar com eles | Interfaces tangíveis para colaboração presencial |

A regra central do framework trata de trade-offs: "the goal is to give up reality only explicitly and only in return for other desired qualities". São seis qualidades: poder expressivo, eficiência, versatilidade, ergonomia, acessibilidade e praticidade. O caso do iPhone é um retrato de 2008: o teclado na tela favorece a versatilidade e abre mão do retorno tátil das teclas físicas. Os temas, dizem, "may not be entirely universal".

### A visão de Weiser, e como citá-la

O artigo é "The Computer for the 21st Century", *Scientific American* 265(3), setembro de 1991. A página da editora mostra o subtítulo: "Specialized elements of hardware and software, connected by wires, radio waves and infrared, will be so ubiquitous that no one will notice their presence". Rogers (2022) dá uma das frases mais citadas do corpo do texto como: "The most profound technologies are those that disappear. They weave themselves into the fabric of everyday life until they are indistinguishable". Ela resume o objetivo como "an easier, calmer way of living".

Bell e Dourish (2007) notam que Weiser formou a visão no fim dos anos 1980 e que o artigo também relatava dispositivos já construídos no Xerox PARC. Pavlus (2013) resume os níveis de dispositivo como tabs (pequenos, vestíveis), pads (de mão, móveis) e boards (grandes, fixos). Bell e Dourish leem o cenário como o trabalho: "a tool for labor".

### Consciência de contexto

Dey et al. (2001), citados por Dourish, definem contexto como "any information that can be used to characterize the situation of entities". Dourish (2004) aponta quatro suposições nisso: contexto é informação, pode ser delimitado de antemão, é estável e é separável da atividade. Depois propõe uma visão interacional, cuja pergunta central é "how and why, in the course of their interactions, do people achieve and maintain a mutual understanding of the context for their actions?" O Exemplo 4 mostra o efeito num design.

### Modalidades, com datas

**Toque.** Na WCAG 2.2 (versão da W3C de 12 de dezembro de 2024), o critério 2.5.8 Target Size (Minimum), novo e de nível AA, pede 24 por 24 pixels CSS, com exceções. O 2.5.5 (Enhanced) pede 44 por 44 no nível AAA. O 2.5.1 Pointer Gestures (nível A) exige que gestos multiponto ou de trajetória também funcionem com um ponteiro e sem trajetória, salvo gesto essencial, e o 2.5.7 Dragging Movements (nível AA, novo) traz regra parecida para arrastar. As Human Interface Guidelines da Apple (novembro de 2026) listam 44x44 pt como tamanho padrão de controle no iOS e 28x28 pt como mínimo. Então "44" é um padrão num fabricante e um limiar AAA em outro documento, com unidades diferentes, não uma lei.

**Voz.** Whitenton e Budiu (NN/g, setembro de 2018) perguntaram a 211 usuários diários de assistentes, entre 464 respondentes, sobre a última interação. A maioria relatou tarefas de um passo, ninguém relatou pesquisa, e mãos livres, sobretudo dirigindo, foi o benefício mais citado (35% desses usuários). As autoras concluem que as pessoas usam assistentes "only for the easiest tasks, mostly when their hands are busy". Isso é autorrelato sobre produtos de 2018. A Amazon anunciou a Alexa+, baseada em IA generativa, em fevereiro de 2025, então o perfil de 2018 precisa de dados novos antes de se supor que vale ou que mudou.

O reconhecimento também falha de forma desigual. Koenecke et al. (PNAS, 2020) rodaram cinco sistemas comerciais em entrevistas com 42 falantes brancos e 73 negros em cinco cidades dos EUA. A taxa média de erro por palavra foi $0{,}35$ para falantes negros e $0{,}19$ para brancos, cerca de 3,5 contra 1,9 erros a cada 10 palavras de referência. O corpus era de entrevistas, não de comandos, e os sistemas são daquela época.

**Gesto.** Norman (2010) escreve: "Most gestures are neither natural nor easy to learn or remember." Sua queixa central: gestos são efêmeros, não deixam registro, e uma resposta errada pouco informa sobre o motivo. Wobbrock et al. (CHI 2009) coletaram 1080 gestos de 20 participantes não técnicos numa mesa interativa, para 27 comandos. Idiomas do desktop influenciaram fortemente os modelos mentais, e alguns comandos geraram pouca concordância, o que sugere widgets na tela (Exemplo 3). A Microsoft encerrou o Kinect em outubro de 2017, depois de 35 milhões de unidades relatadas nas duas versões, mas preço e conteúdo também pesam nisso, então não é resultado de usabilidade. Gestos de toque como a pinça se espalharam, e o ensaio de Norman os trata como convenções que se desenvolvem e se aprendem.

**Olhar.** Jacob (CHI 1990) nomeou o risco central: "Everywhere you look, another command is activated; you cannot look anywhere without issuing a command." O visionOS da Apple (orientações de novembro de 2026) separa os dois atos: olhar destaca, e um gesto indireto confirma. E pede: "give people multiple ways to interact".

### Livro vs hoje: a visão de Weiser

| Afirmação, como relatada | O que se confirmou | O que não se confirmou, ou mudou |
|---|---|---|
| A computação se espalha pela vida cotidiana | "Computation is embedded into the technology and practice of everyday life" (Bell e Dourish 2007). 91% dos adultos dos EUA têm smartphone, contra 35% em 2011 (Pew, 2026; só EUA, modo mudou em 2023) | Boa parte foi para um dispositivo pessoal, que Rogers (2022) diz que "became an extension of ourselves, rather than disappearing into the environment" |
| Tabs, pads, boards | Celulares, tablets e relógios cabem de modo frouxo (Pavlus 2013: o smartphone ficou entre tab e pad) | Só "family resemblances" (Bell e Dourish), não uma correspondência |
| A tecnologia desaparece | Usamos dispositivos "without thinking of them as computational" (Bell e Dourish) | "Rather than being invisible or unobtrusive, ubicomp devices are highly present, visible, and branded" (mesmo artigo) |
| Ruptura com o paradigma do desktop | Surgiram novas classes de dispositivo | "The desktop computer has not been displaced, but augmented" (Bell e Dourish, 2007) |
| Infraestrutura sem emendas e calma | | Bell e Dourish chamam o resultado de bagunçado. Rogers relata que a computação "had taken quite different turns from being calm" |
| Uso no trabalho | O trabalho segue sendo um dos usos | Usos sociais, domésticos, religiosos e políticos, listados por Bell e Dourish |

O artigo de Bell e Dourish, aceito em 2006, é anterior ao smartphone de 2007 no relato de Rogers e chama a visão de "a very American one". Rogers defende engajamento em vez de calma, posição de design, não medição.

## Exemplos Resolvidos

### Exemplo 1: uma leitura RBI de um mapa web no celular

Esta tabela é análise desta lição, não de Jacob et al. A WCAG se aplica porque o mapa é conteúdo web.

| Recurso | Tema RBI ou trade-off |
|---|---|
| Lançar para deslocar, com inércia | Física ingênua |
| Pinça para zoom | Habilidade do corpo, ainda que convenção aprendida |
| Vista acompanha a posição do usuário | Consciência do ambiente |
| Caixa de busca | Abre mão da realidade por eficiência e poder expressivo |
| Botões de zoom | Abre mão da realidade por acessibilidade: o 2.5.1 exige ponteiro único para o que a pinça faz, e o 2.5.7 exige deslocar sem arrastar |

Os botões parecem redundantes até você perguntar quem não consegue fazer a pinça.

### Exemplo 2: tamanho de alvo, em números

Pegue uma fileira de ícones de 20 por 20 pixels CSS, abaixo de 24. Eles ainda passam pela exceção Spacing se um círculo de 24 pixels de diâmetro centrado em cada um não cruzar outro alvo nem o círculo de outro alvo pequeno.

```text
width 20, gap 2: pitch 22, circles overlap    -> spacing exception fails
width 20, gap 4: pitch 24, circles just touch -> boundary
width 20, gap 6: pitch 26, circles clear      -> spacing exception passes
```

Círculos de diâmetro 24 param de se sobrepor quando a distância entre centros chega a 24, então um gap de 4 é o limite. Um layout real checa cada vizinho. Agora use a forma de Shannon de `fitts-law-and-hicks-law`, $ID=\log_2(D/W+1)$, para um percurso do polegar de $D=300$ pixels:

```text
D=300, W=24: ID = 3.75 bits
D=300, W=44: ID = 2.97 bits
```

A diferença é de cerca de 0,8 bit. Convertê-la em milissegundos exigiria $a$ e $b$ de regressão num dispositivo, então nenhum tempo é afirmado. Passar no 2.5.8 é um piso, não prova de conforto.

### Exemplo 3: concordância de gestos

Para um comando, Wobbrock et al. agrupam gestos idênticos e calculam $A_r=\sum_i(\lvert P_i\rvert/\lvert P_r\rvert)^2$, e depois tiram a média entre comandos. O "move a little" deles (duas mãos) teve grupos de 12, 3, 3 e 2 em 20, o que dá $0{,}415$ (o artigo arredonda para 0,42). A concordância geral foi 0,32 com uma mão e 0,28 com duas.

Os três comandos abaixo são fictícios:

```text
command   groups (20 people)     A
delete    14, 4, 2               0.540
undo      6, 5, 5, 4             0.255
help      4, 3, 3, 3, 3, 2, 2    0.150
```

Com 20 pessoas, o piso é $0{,}05$ (todos diferentes). Um designer poderia manter o gesto em "delete" e dar a "help" um widget na tela, a direção que o artigo sugere para baixa concordância. O artigo não define corte universal, e os números vêm de um estudo em mesa interativa.

### Exemplo 4: uma regra de contexto que quebra

Um celular silencia chamadas quando o calendário mostra reunião e a localização diz "escritório". A regra trata o contexto como delimitável e estável. Agora o usuário espera uma ligação do hospital. Os campos estão certos e a ação está errada, porque importa como os envolvidos entendem a situação. Pela visão de Dourish (a solução é desta lição, não dele), o design mostra o que inferiu e oferece correção em um passo.

## Equívocos Comuns e Armadilhas

- **"Weiser previu o smartphone."** Os níveis lembram dispositivos posteriores, mas Rogers nota que o celular virou extensão de nós em vez de desaparecer.
- **"O pós-WIMP substituiu o WIMP."** Bell e Dourish relataram aumento em 2007, e Jacob et al. usam atalhos de teclado de especialistas como caso em que a eficiência vence a realidade.
- **"Natural significa sem aprendizado."** Para Norman, a maioria dos gestos precisa ser aprendida, e Wobbrock mostra baixa concordância em alguns comandos.
- **"Voz é mãos livres, logo é acessível."** Os erros em Koenecke et al. diferem por grupo, e quem não fala com clareza precisa de outra via.
- **"Consciência de contexto significa mais sensores."** A objeção de Dourish vale também para dados perfeitos.

## Resumo

WIMP nomeia uma geração, pós-WIMP (van Dam, via Jacob et al.) um conjunto amplo de técnicas, e noncommand (Nielsen) uma mudança em quem controla o diálogo. A RBI explica o que muitos estilos tomam da realidade e pede que ela só seja trocada por qualidades nomeadas. A visão de Weiser acertou na difusão da computação e errou em invisibilidade, ausência de emendas, calma e no foco no trabalho (Bell e Dourish 2007; Rogers 2022). Afirmações sobre modalidades precisam de data, população e tarefa.

## Documentation Links

- [Jacob et al. (2008): Reality-Based Interaction](https://www.cs.tufts.edu/~jacob/papers/chi08.pdf): temas, trade-offs e o caso do iPhone.
- [Nielsen (1993): Noncommand User Interfaces](https://www.nngroup.com/articles/noncommand/): gerações, WIMP e interfaces sem comando.
- [Scientific American: The Computer for the 21st Century](https://www.scientificamerican.com/article/the-computer-for-the-21st-century/): citação e subtítulo.
- [Bell e Dourish (2007): Yesterday's Tomorrows](https://www.dourish.com/publications/2007/BellDourish-YesterdaysTomorrows-PUC.pdf): a visão diante da prática posterior.
- [Rogers (2022): The Four Phases of Pervasive Computing](https://discovery.ucl.ac.uk/10153147/1/Rogers_Four%20Phases%20of%20Pervasive%20Computing-Rogers-Jun22.pdf): cita Weiser e revê o campo.
- [Pavlus (2013): How Smart Watches and Phablets Fulfill a 20-Year-Old Prophecy](https://www.technologyreview.com/2013/03/18/179356/how-smart-watches-and-phablets-fulfill-a-20-year-old-prophecy-about-ubiquitous-computing/): os níveis de dispositivo, lidos em 2013.
- [Dourish (2004): What We Talk About When We Talk About Context](https://www.dourish.com/publications/2004/PUC2004-context.pdf): duas visões de contexto.
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/): critérios 2.5.1, 2.5.5, 2.5.7, 2.5.8.
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): tamanhos de controle por plataforma.
- [Apple HIG: Eyes](https://developer.apple.com/design/human-interface-guidelines/eyes): olhar no visionOS.
- [Whitenton e Budiu (2018): The Paradox of Intelligent Assistants](https://www.nngroup.com/articles/intelligent-assistants-poor-usability-high-adoption/): 211 usuários diários.
- [Koenecke et al. (2020): Racial Disparities in Automated Speech Recognition](https://ideas.repec.org/a/nas/journl/v117y2020p7684-7689.html): resumo.
- [Amazon (2025): Introducing Alexa+](https://www.aboutamazon.com/news/devices/new-alexa-generative-artificial-intelligence): anúncio do fabricante.
- [Norman (2010): Natural User Interfaces Are Not Natural](https://jnd.org/natural-user-interfaces-are-not-natural/): o ensaio.
- [Wobbrock et al. (2009): User-Defined Gestures for Surface Computing](https://faculty.washington.edu/wobbrock/pubs/chi-09.02.pdf): elicitação e concordância.
- [Game Developer (2017): Microsoft kills the Kinect](https://gamedeveloper.com/business/microsoft-kills-the-kinect-as-production-shuts-down): fim da produção.
- [Jacob (1990): What You Look At Is What You Get](https://www.cs.tufts.edu/~jacob/papers/chi90.pdf): o problema do toque de Midas.
- [Pew Research Center (2026): Americans' Use of Mobile Devices](https://www.pewresearch.org/internet/fact-sheet/mobile/): dados de posse nos EUA.
