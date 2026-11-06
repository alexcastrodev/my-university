---
version: 1.0
updatedAt: 2026-11-04
title: "Fidelidade de Protótipos: Sketch, Wireframe, Mockup, Protótipo"
summary: "Sketch, wireframe, mockup e protótipo: a pergunta que cada fidelidade responde e o custo de testar na fidelidade errada."
---
## Objetivos de Aprendizagem

- Explicar por que fidelidade é um conjunto de dimensões, e não uma única escala de baixo a alto.
- Definir sketch, wireframe, mockup e protótipo, e dizer qual dimensão cada um eleva e qual deixa baixa.
- Relatar o que Virzi, Sokolov e Karis (1996) e Walker, Takayama e Landay (2002) mediram, incluindo os limites de cada estudo.
- Escolher um artefato a partir da pergunta que precisa de resposta e nomear o que esse artefato não consegue dizer.
- Nomear os custos documentados de testar em fidelidade baixa demais e de construir fidelidade alta demais.

## Contexto e Motivação

`user-research-interviews-personas-task-analysis` deixa você com usuários, tarefas e um conjunto de palpites sobre o que ajudaria essas pessoas. Esses palpites são hipóteses, e o protótipo é a coisa mais barata capaz de derrubar uma delas. Pernice (2016, NN/g) diz isso de forma direta: "A user interface prototype is a hypothesis". `requirements-elicitation-specification-and-validation` já lista a prototipagem como técnica de elicitação, boa para necessidades que só aparecem quando existe algo concreto. Esta lição faz a pergunta seguinte: concreto até que ponto, e em qual aspecto?

A resposta habitual é uma escada: sketch, depois wireframe, depois mockup, depois protótipo, cada degrau melhor que o anterior. Essa imagem erra de dois jeitos. As quatro palavras não ficam num só eixo, e os estudos não mostram que um degrau mais alto encontra mais problemas de usabilidade. `usability-testing-and-the-system-usability-scale` trata de como conduzir o teste. Esta lição trata do que colocar diante do participante.

## Teoria Central

### Fidelidade tem dimensões

Walker et al. (2002) descrevem fidelidade como a facilidade de distinguir um protótipo do produto final. A pergunta real é: distinguir em quê? Virzi et al. (1996) chamam a fidelidade de "a continuum, not a dichotomy" e nomeiam quatro dimensões em que um protótipo pode diferir do produto:

- **Amplitude de funcionalidades (breadth of features):** quantas funcionalidades ele suporta.
- **Grau de funcionamento (degree of functionality):** quão completa é a operação de cada funcionalidade.
- **Semelhança de interação (similarity of interaction):** como o usuário se comunica com ele (botões, mouse, toque, fala).
- **Refinamento estético (aesthetic refinement):** aspectos que não afetam diretamente a função, como cor e design gráfico.

Lim, Stolterman e Tenenberg (2008) oferecem um vocabulário mais fino. As **dimensões de filtragem** dizem qual aspecto do design o protótipo explora: aparência, dados, funcionalidade, interatividade e estrutura espacial. As **dimensões de manifestação** dizem como ele é construído: material (papel, código), resolução (nível de detalhe, que eles equiparam à fidelidade) e escopo (quanto do design ele cobre). Eles argumentam que a distinção binária entre baixa e alta fidelidade pode ser problemática e citam McCurdy et al. (2006) como demonstração de um protótipo de fidelidade mista, baixa em algumas dimensões e alta em outras.

Baixa fidelidade também não significa pouca função. No segundo experimento de Virzi, o sistema de voz de baixa fidelidade era uma pessoa lendo os prompts em voz alta, e qualquer ação possível no sistema final era possível ali.

### Os quatro artefatos

Os termos são convenções, não normas, e as equipes os usam com folga. O glossário da NN/g (Wang 2024) traz definições úteis:

- **Wireframe:** "A skeletal outline of a design layout used to represent the structure and functionality of an interface before visual design is considered."
- **Mockup:** "A static, high-fidelity simulation of a proposed UI design that includes visual-design details such as colors and imagery."
- **Protótipo:** "An early version of a design used to test and validate ideas, interactions, and functionality."

**Sketch** não tem verbete próprio ali. Use o termo para um desenho rápido e tosco cujo trabalho é explorar opções, em geral no papel. Gordon (2021, NN/g) avisa que os próprios wireframes vão de rascunhos rápidos a representações detalhadas, então a fronteira entre sketch e wireframe é tanto de intenção quanto de traço.

A tabela é uma síntese desta lição, com os nomes de dimensão de Lim. Ela não vem de uma fonte única.

| Artefato | Eleva | Deixa baixo | Responde |
|---|---|---|---|
| Sketch | Velocidade e número de alternativas | Aparência, interatividade, dados | Quais ideias merecem mais trabalho? |
| Wireframe | Estrutura espacial, hierarquia de conteúdo | Aparência, em geral interatividade | O conteúdo certo está no lugar certo? |
| Mockup | Aparência | Interatividade, funcionalidade | Parece certo, e a hierarquia visual funciona? |
| Protótipo | Interatividade, e funcionalidade conforme a necessidade | O que a pergunta ignora | As pessoas conseguem fazer a tarefa? |

Portanto "protótipo" não é um degrau acima do mockup. O termo nomeia um comportamento, responder ao usuário, e pode ser feito de qualquer coisa. Um protótipo de papel tem aparência baixa e lógica de interação real. Um mockup clicável tem aparência alta e alguns caminhos fixos.

### Quem faz o papel do computador

Alguma coisa precisa responder ao participante. Pernice (2016) separa protótipos **interativos**, em que cada resposta é construída antes do teste, de **estáticos**, em que uma pessoa responde durante o teste. No papel, uma pessoa troca as folhas conforme o participante toca nelas. No **Wizard of Oz**, uma pessoa escondida controla remotamente a tela do participante. A troca é entre preparo antes do teste e risco de erro durante ele.

### O que os estudos mediram

**Virzi, Sokolov e Karis (1996).** Dois experimentos entre sujeitos, cada um com 20 sujeitos em idade universitária (10 por condição) pensando em voz alta. O Experimento 1 testou um livro eletrônico: uma versão em papel com mais de 100 fichas contra o produto real. O Experimento 2 testou um sistema de resposta por voz: uma pessoa lendo os prompts contra um protótipo funcional de alta fidelidade. O achado principal: substancialmente os mesmos problemas apareceram nas duas condições.

| | Exp. 1, alta | Exp. 1, baixa | Exp. 2, alta | Exp. 2, baixa |
|---|---|---|---|---|
| Parcela média de problemas por sujeito | 38% | 34% | 40% | 46% |
| Problemas achados pelo grupo | 34 de 38 | 32 de 38 | 19 de 21 | 20 de 21 |

As diferenças de sensibilidade não foram significativas ($t(37)=1.08$, $p=.29$, e $t(20)=.870$, $p=.39$), e a detecção de problemas se correlacionou entre as condições ($r=.58$ e $r=.49$). Os próprios autores declaram os limites: não se prova a hipótese nula, os resultados valem para teste com think-aloud e a severidade não foi medida formalmente.

**Walker, Takayama e Landay (2002).** 28 participantes recrutados na região, nenhum com experiência profissional em desenvolvimento web, fizeram cinco tarefas de banco on-line em dois sites. O desenho cruzou fidelidade (esboço ou HTML) com meio (papel ou computador). Cada pessoa viu os dois meios em uma só fidelidade. Os autores inseriram problemas de usabilidade de propósito, usando as heurísticas de Nielsen. Os participantes acharam em média 34,6 problemas distintos de um total de 169, sem diferença significativa por fidelidade ou por meio, e a severidade também não diferiu. As pessoas fizeram cerca de cinco comentários a mais no computador do que no papel, sem achar mais problemas. Uma diferença sobrevive: contando por problema, os *tipos* de problema diferiram por fidelidade ($\chi^2=30.70$, $p<.01$). A análise não permitiu atribuir isso a um tipo específico.

Nenhum dos estudos mostra que a fidelidade é irrelevante. Ambos mostram que, para achar problemas de usabilidade em testes de tarefa com think-aloud naqueles produtos, elevar a fidelidade não elevou o rendimento.

### O custo da fidelidade errada

**Baixa demais: a pergunta mora numa dimensão que você falsificou.** Wiklund et al. (1992), conforme relatado por Virzi et al., pediram a pessoas que avaliassem protótipos de um dicionário eletrônico em quatro níveis de realismo. O realismo não mudou as notas. Mas os protótipos não reproduziam os tempos de resposta lentos do aparelho, e por isso todos foram avaliados como mais usáveis do que o aparelho real. No próprio Experimento 2 de Virzi, dois problemas foram achados por quase todos os sujeitos de alta fidelidade e por poucos de baixa, porque as duas versões tratavam de forma diferente o salvamento de alterações. Um protótipo só revela o que reproduz.

**Alta demais: você paga por dimensões de que a pergunta não precisa.** O protótipo de voz de Virzi levou mais de dois meses e continha mais de 5.000 ícones TFLX, sete bancos de dados e mais de 500 arquivos de som. Os autores escreveram que, se tivessem feito o experimento um ano antes, não o teriam construído para teste de usabilidade. Hong et al. (2001), conforme relatado por Walker et al., constataram que os usuários avaliaram protótipos de fidelidades diferentes de modo diferente em "finishedness" e "likeliness to change", enquanto suas prioridades de melhoria não diferiram.

**Poucas alternativas.** Tohidi et al. (2006) compararam testar um design com testar três designs funcionalmente equivalentes, mas de estilos distintos. Com um único design, os usuários deram notas significativamente mais altas e menos feedback negativo. Isso diz respeito ao número de designs, não à fidelidade, mas alerta contra ler elogio a um candidato polido como evidência.

Pernice (2016) acrescenta que designers se apegam menos a trabalho tosco e que o polimento pode levar um executivo a dizer "let's make it go live now". Isso é julgamento de quem pratica, sem medição.

## Exemplos Resolvidos

### Exemplo 1: escolhendo pela pergunta

Uma universidade quer um fluxo de matrícula no celular. A tabela ilustra o raciocínio e não tem dados de usuários por trás.

| Pergunta | Precisa ser real | Pode ser falso | Artefato |
|---|---|---|---|
| A ordem dos passos combina com o jeito de planejar dos alunos? | Sequência de passos | Tudo que é visual | Sketches, uma pessoa trocando folhas |
| Eles acham um conflito de horário na grade? | Layout, dados reais de disciplinas | Cor, marca | Wireframe com dados reais |
| Um selo de conflito é lido como impedimento? | Cor, tipografia, contraste | Comportamento | Mockup, mostrado e discutido |
| Eles conseguem arrastar uma disciplina enquanto as vagas acabam? | Toque, tempo, estado ao vivo | Amplitude de outras funcionalidades | Protótipo em código num celular |

Cada linha escolhe o artefato mais barato em que a dimensão decisiva é real. A última linha exige código porque a semelhança de interação é a própria pergunta, e o resultado de Wiklund alerta contra chutar o tempo de resposta.

### Exemplo 2: lendo os números de Virzi

Virzi traça a descoberta esperada com a fórmula de um trabalho anterior, em que $p$ é a probabilidade média de detectar um problema e $n$ o número de sujeitos:

$$\text{found}(n)=1-(1-p)^n$$

Rodando a fórmula para o Experimento 1 e comparando com os totais observados dos grupos:

```text
p       n=1    n=3    n=5    n=10   observado com 10 sujeitos
0.38    0.380  0.762  0.908  0.992  34/38 = 0.895
0.34    0.340  0.713  0.875  0.984  32/38 = 0.842
```

Os dois usam o mesmo denominador, os 38 problemas distintos, então a comparação é justa. A fórmula passa do observado, provavelmente porque um único $p$ médio trata todo problema como igualmente detectável, enquanto o artigo relata um problema achado por 80% dos sujeitos e outros achados por uma única pessoa.

Os totais também delimitam a sobreposição. Os 38 problemas foram achados por pelo menos um grupo, então $34+32-38=28$ foram achados pelos dois, o que deixa 6 achados só em alta fidelidade e 4 só em baixa. No Experimento 2, $19+20-21=18$ foram comuns, com 1 e 2 exclusivos. Assim, "os mesmos problemas" quer dizer conjuntos com forte sobreposição, não idênticos. Os autores atribuem a maior parte do restante à variabilidade normal, mas registram que não têm evidência para sustentar essa crença.

### Exemplo 3: elevando uma dimensão

Uma caixa de busca precisa ser aceitável mesmo com o backend levando cerca de 1,8 segundo (valor suposto neste exemplo). Um teste em papel não revela a espera, e uma construção completa é prematura. Mantenha a aparência como sketch digitalizado, como Walker et al. fizeram com áreas clicáveis sobre esboços, e torne real só o tempo:

```js
// A aparência continua sendo um sketch. Só o tempo de resposta é real.
async function showResults(results) {
  spinner.hidden = false;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  spinner.hidden = true;
  list.replaceChildren(...results.map(render));
}
```

Isso é fidelidade mista na prática: uma dimensão em nível de produto, o resto deliberadamente baixo. Responde se as pessoas esperam e entendem a espera, e não diz nada sobre o design visual.

## Equívocos Comuns e Armadilhas

- **"Baixa fidelidade acha menos problemas."** Virzi e Walker não encontraram diferença significativa na contagem, nas suas tarefas e com think-aloud. A afirmação que sobrevive é mais estreita do que "fidelidade nunca importa".
- **"Então alta fidelidade é desperdício."** Não quando a pergunta é sobre tempo de resposta, sensação de uso ou um comportamento que a versão barata trata de outro jeito. Os dois problemas discrepantes de Virzi vieram exatamente disso.
- **"Papel sempre vem primeiro."** Virzi relata colegas duvidando de que o resultado valha para manipulação direta, sistemas imersivos ou sensíveis a tempo de resposta, responde "We are not so sure" e deixa os limites exatos para pesquisas futuras. Para uma pergunta de gesto ou de latência, o papel pode não responder nada.
- **"Mockup clicável é alta fidelidade."** Ele é alto em aparência e baixo em funcionalidade e dados. Nomeie as dimensões e a confusão some.
- **"Dá para fazer teste de usabilidade com o mockup como está."** Uma imagem estática serve para perguntas de compreensão e hierarquia. Testar um fluxo exige algo, ou alguém, que responda.
- **"Os usuários vão dizer como consertar."** Tohidi et al. concluem que o teste de usabilidade "is a means to identify problems, not provide solutions."
- **Falsificar dados sem perceber.** Lorem ipsum e nomes de exemplo arrumados escondem o que rótulos longos e estados vazios fazem. Dados também são uma dimensão.

## Resumo

Fidelidade são várias dimensões: amplitude, funcionamento, interação e aparência nos termos de Virzi, e aparência, dados, funcionalidade, interatividade e estrutura espacial nos de Lim. O sketch eleva velocidade e alternativas, o wireframe eleva estrutura, o mockup eleva aparência e o protótipo acrescenta resposta, em qualquer material. Dois estudos controlados constataram que protótipos de baixa fidelidade revelaram cerca de tantos problemas de usabilidade quanto os de alta em teste com think-aloud, embora não conjuntos idênticos, e Walker et al. acharam diferenças nos tipos de problema. A fidelidade falha quando a pergunta mora numa dimensão que o artefato falsifica, como nos tempos de resposta não representados no estudo de Wiklund, e desperdiça dinheiro quando você constrói dimensões que a pergunta ignora, como no protótipo de voz de dois meses de Virzi. Comece pela pergunta, torne real a dimensão decisiva e deixe o resto barato.

## Documentation Links

- [Virzi, Sokolov, Karis (1996): Usability Problem Identification Using Both Low- and High-Fidelity Prototypes](https://chi1996.acm.org/proceedings/papers/Virzi/RAVtext.html): os dois experimentos, as quatro dimensões de fidelidade e o relato de Wiklund et al.
- [Walker, Takayama, Landay (2002): High-Fidelity or Low-Fidelity, Paper or Computer?](https://www.leilatakayama.org/downloads/Takayama.Prototypes_HFES2002_prepress.pdf): prepress da autora, com o experimento 2 por 2 sobre fidelidade e meio.
- [Lim, Stolterman, Tenenberg (2008): The Anatomy of Prototypes](https://faculty.washington.edu/jtenenbg/publications/limAnatomyOfPrototypes-tochi2008.pdf): cópia de autor, com as dimensões de filtragem e de manifestação.
- [Tohidi, Buxton, Baecker, Sellen (2006): Getting the Right Design and the Design Right](https://www.microsoft.com/en-us/research/publication/getting-the-design-right-and-the-right-design-testing-many-is-better-than-one/): resumo do estudo que compara testar um design com testar três.
- [Pernice (2016): UX Prototypes, Low Fidelity vs. High Fidelity](https://www.nngroup.com/articles/ux-prototype-hi-lo-fidelity/): protótipos interativos e estáticos e trade-offs de quem pratica.
- [Wang (2024): UX Deliverables Glossary](https://www.nngroup.com/articles/ux-deliverables-glossary/): definições de wireframe, mockup e protótipo.
- [Gordon (2021): How to Draw a Wireframe](https://www.nngroup.com/articles/draw-wireframe-even-if-you-cant-draw/): a faixa de fidelidade dos wireframes e como desenhar um.
