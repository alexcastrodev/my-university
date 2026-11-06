---
version: 1.0
updatedAt: 2026-11-04
title: "As Dez Heurísticas de Nielsen e a Avaliação Heurística"
summary: "As dez heurísticas de Nielsen e como conduzir uma avaliação heurística, incluindo escalas de severidade e quantos avaliadores são necessários."
---
## Objetivos de Aprendizagem

- Distinguir quatro coisas que costumam ser fundidas: as nove heurísticas de 1990, o refinamento de 1994, a atualização de redação de 2020 e a escala de severidade de 0 a 4.
- Conduzir uma avaliação heurística na ordem dada pelas fontes: inspeção independente primeiro, agregação depois, severidade por último.
- Calcular a curva de Nielsen e Landauer, enunciar o que ela supõe e mostrar a distância entre a fórmula e a curva medida pelo próprio Nielsen.
- Mostrar como o "melhor" número de avaliadores se move com a taxa de detecção, os custos e o objetivo otimizado.
- Dizer o que o método não entrega, e quando uma violação não é um problema.

## Contexto e Motivação

`usability-and-its-definition-iso-9241-11` fez da usabilidade um resultado do uso real, que é caro de observar. A avaliação heurística é uma previsão mais barata: alguns avaliadores inspecionam a interface contra princípios reconhecidos e listam onde ela os quebra. Nielsen a chamou explicitamente de método de "discount usability engineering", que não promete achar todo problema. Moran e Gordon (2023) a descrevem como útil para problemas gritantes e para esticar um orçamento limitado de pesquisa, e afirmam que ela não substitui a pesquisa com usuários.

Nenhum usuário representativo participa deste método, então um achado é a previsão de um especialista até alguém o observar.

## Teoria Central

### Quatro coisas com um nome só

| Ano | Item | Fonte |
|---|---|---|
| 1990 | Nove heurísticas | Molich e Nielsen, "Improving a human-computer dialogue", CACM 33(3), 338-348 |
| 1990 | O método | Nielsen e Molich, "Heuristic evaluation of user interfaces", CHI'90, 249-256 |
| 1994 | Dez heurísticas revistas, a partir de uma análise fatorial de 249 problemas de usabilidade | Nielsen, "Enhancing the explanatory power of usability heuristics", CHI'94, 152-158, e um capítulo em *Usability Inspection Methods* |
| 1994 | Escala de severidade | Nielsen, "Severity Ratings for Usability Problems", NN/g, 1 de novembro de 1994 |
| 2020 | Definições reescritas, novos exemplos | Página da NN/g, datada de 24 de abril de 1994, revisada em 30 de janeiro de 2024 |

As citações estão como a NN/g as dá, e os nomes de 1990 são os que Molich lista no site dele. A nota de Nielsen na página da NN/g diz que a atualização de 2020 refinou levemente a linguagem e que as heurísticas em si não mudam desde 1994. A reescrita é visível. A página de Molich sobre o conjunto de 1994 imprime "The system should always keep users informed about what is going on, through appropriate feedback within reasonable time" para a primeira heurística, e a NN/g hoje imprime "The design should always keep users informed about what is going on, through appropriate feedback within a reasonable amount of time."

### De nove para dez

Comparar as duas listas dá a tabela abaixo. O mapeamento é uma leitura das duas listas, e nenhuma das fontes o imprime. Os nomes ficam em inglês, como foram publicados.

| 1990 (Molich e Nielsen) | Número e nome de 1994, como a NN/g intitula |
|---|---|
| 5 Provide Feedback | 1 Visibility of System Status |
| 2 Speak the User's Language | 2 Match Between the System and the Real World |
| 6 Provide Clearly Marked Exits | 3 User Control and Freedom |
| 4 Be Consistent | 4 Consistency and Standards |
| 9 Error Prevention | 5 Error Prevention |
| 3 Minimize the User's Memory Load | 6 Recognition Rather than Recall |
| 7 Provide Shortcuts | 7 Flexibility and Efficiency of Use |
| 1 Simple and Natural Dialogue | 8 Aesthetic and Minimalist Design |
| 8 Provide Good Error Messages | 9 Help Users Recognize, Diagnose, and Recover from Errors |
| (nenhuma) | 10 Help and Documentation |

O item 1 de 1990 também trazia "natural and logical order", que a NN/g hoje coloca na heurística 2. Para as definições, leia a página da NN/g: os nomes acima são uma lista de conferência, e o que se aplica são as frases da página.

### O método

Combinando Nielsen (1994) e Moran e Gordon (2023):

1. **Prepare.** Escolha o conjunto de heurísticas, treine os avaliadores, defina o escopo. Num sistema dependente de domínio, forneça um cenário de uso construído a partir de uma análise de tarefas, como em `user-research-interviews-personas-task-analysis`.
2. **Inspecione sozinho.** Cada avaliador trabalha de forma independente, em geral uma ou duas horas, percorrendo a interface pelo menos duas vezes: uma pelo fluxo, outra pelos elementos específicos. Ninguém vê os achados dos outros até todos terminarem.
3. **Relate cada problema em separado**, com a heurística violada. Dizer que não gostou de algo não é achado. Listar em separado importa porque um redesenho pode repetir um problema que ninguém nomeou.
4. **Agregue e discuta.** Agrupe as questões e faça uma sessão de debriefing com o time de design.
5. **Atribua severidade** sobre a lista fundida.

A saída é uma lista de problemas, não um design. E violação não é automaticamente defeito: o exemplo de Moran e Gordon é um menu hambúrguer que viola a heurística 6 e ainda assim pode ser uma troca necessária numa tela pequena, o que só a pesquisa decide.

### Severidade é um instrumento à parte

A escala de Nielsen, de 1994, vai de 0 a 4:

```text
0  não concordo que isto seja um problema de usabilidade
1  cosmético: corrigir só se sobrar tempo
2  menor: prioridade baixa
3  maior: prioridade alta
4  catástrofe de usabilidade: imperativo corrigir antes do lançamento
```

A severidade combina frequência, impacto e persistência, e Nielsen acrescenta o impacto de mercado como consideração adicional. Ele sugere coletar as notas depois das sessões, por um questionário com todos os problemas fundidos, porque avaliadores focados em achar estimam mal, e cada um viu só um subconjunto. Cada um avalia de forma independente, em cerca de 30 minutos. Ele diz que as notas de um avaliador só são pouco confiáveis e que a média de três é satisfatória para muitos fins práticos. Ele apresenta isso como experiência própria, então trate como conselho, não como limiar medido.

### Quantos avaliadores

O modelo de Nielsen e Landauer, como Nielsen o relata, é

$$\text{ProblemsFound}(i)=N\bigl(1-(1-\lambda)^i\bigr),$$

com $N$ o total de problemas, $\lambda$ a proporção achada por um avaliador e $i$ avaliadores independentes. Em seis estudos de caso, $\lambda$ variou de 19% a 51%, com média de 34%, e $N$ de 16 a 50, com média de 33. A mesma página diz que avaliadores sozinhos acharam 35% na média de seis projetos dele.

Como escrita, a fórmula trata os avaliadores como independentes e deixa um único $\lambda$ descrever todo avaliador e todo problema. A segunda suposição falha nos próprios dados de Nielsen. A Figura 1 da mesma página mostra problemas achados por quase todos e outros por muito poucos, e Nielsen (1992) relata 42% para problemas maiores contra 32% para menores, por avaliador. $N$ também é desconhecido na prática: é, no melhor caso, o que se conhece depois de muita busca.

## Exemplos Resolvidos

### Exemplo 1: a fórmula contra a curva medida

```text
avaliadores            1      2      3      5     10     15
fórmula, lambda=0,19  19,0   34,4   46,9   65,1   87,8   95,8
fórmula, lambda=0,34  34,0   56,4   71,3   87,5   98,4   99,8
fórmula, lambda=0,51  51,0   76,0   88,2   97,2   99,9  100,0
```

Agora leia a Figura 2 da página de Nielsen, a média de seis estudos de caso: cerca de 34% com um avaliador, 74% com cinco, 87% com dez, 91% com quinze (valores lidos no gráfico, portanto aproximados). A fórmula no $\lambda$ médio diz 87,5% com cinco e 99,8% com quinze. As duas começam juntas e depois diferem em cerca de 9 a 14 pontos, então a fórmula com um $\lambda$ médio é otimista.

Dois tipos de dispersão podem causar isso, e nenhum está na fórmula. Entre projetos: seis valores supostos de $\lambda$ (0,19; 0,25; 0,30; 0,35; 0,44; 0,51, média 0,34) dão média de 84,1% com cinco, o que explica só parte da distância. Entre problemas: um ajuste feito para esta lição, que não vem da fonte, põe 58% dos problemas em $p=0{,}51$ e 42% em $p=0{,}106$ (média ainda 0,34) e dá cerca de 74%, 86% e 92% com 5, 10 e 15. Muitas misturas se ajustam, então isso mostra apenas que problemas difíceis bastam para dobrar a curva para baixo.

### Exemplo 2: o ótimo se move

O projeto de amostra de Nielsen tem custo fixo de US\$ 4.000, US\$ 600 por avaliador e US\$ 15.000 por problema achado (valor que Nielsen e Landauer derivaram em 1993, e só problemas de fato corrigidos dão retorno). Ele relata ótimo de quatro avaliadores, custo de US\$ 6.400, benefícios de US\$ 395.000 e razão de 62. A página não informa $N$ e $\lambda$. O par $N=33$, $\lambda=0{,}33$ reproduz esses números e a forma da Figura 3, e esse par é uma inferência. Com ele:

```text
avaliadores        1      2      3      4      5      6      7
benefício/custo  35,5   52,5   59,7   61,8   61,2   59,2   56,7
```

A melhor razão se move com as suposições, mantendo $N=33$:

```text
lambda   fixo    por avaliador   melhor i   razão
0,33     4.000   600             4          61,8
0,19     4.000   600             6          46,7
0,51     4.000   600             3          75,3
0,33     3.700   410             5          74,5
0,33     4.800   900             4          47,1
```

As duas últimas linhas pareiam os extremos baixos e os extremos altos das faixas de custo que Nielsen publica. $N$ e o valor por problema não movem a melhor razão, já que os dois só reescalam o benefício. O objetivo move. Neste modelo, o quinto avaliador acrescenta cerca de US\$ 32.917 de benefício por US\$ 600, e o décimo quarto ainda acrescenta cerca de US\$ 896. O benefício líquido (benefício menos custo) segue subindo até cerca de 15 avaliadores, muito além da melhor razão. "Três a cinco" é a resposta à pergunta da razão, com esses valores em dólar e com uma fórmula que o Exemplo 1 mostrou ser otimista. O próprio Nielsen diz que se deve usar mais avaliadores quando a usabilidade é crítica ou o retorno é grande.

### Exemplo 3: estimar lambda pelos próprios resultados o infla

Não dá para ver problemas que ninguém achou, então um time que calcula $\lambda$ pelos próprios achados divide pelos problemas encontrados, não por $N$. Sob as suposições da própria fórmula, essa estimativa é

$$\hat\lambda=\frac{\lambda}{1-(1-\lambda)^n}.$$

Com $\lambda=0{,}34$ verdadeiro e $n=3$ avaliadores, $\hat\lambda=0{,}477$. Colocada de volta na fórmula, ela prevê cobertura de 85,7% quando o valor verdadeiro é 71,3%. A linha do tempo de Sauro registra o mesmo alerta, de Hertzum e Jacobsen (2001), para dados iniciais com usuários.

### Exemplo 4: severidade sobre uma lista fundida

Os problemas e notas abaixo são fictícios, inventados para o site de agendamento da lição anterior só para mostrar a aritmética.

```text
problema                                         heurística  A1 A2 A3  média
P1 sessão expira e apaga o formulário            5            4  3  4   3,67
P3 data é DD/MM numa tela e MM/DD na seguinte    4            3  4  2   3,00
P2 "ERR_SLOT_409" quando o horário acabou de sair 9           3  3  2   2,67
P4 menu hambúrguer esconde "Minhas consultas"    6            2  0  1   1,00
P5 dois pesos de fonte para o mesmo rótulo       8            1  1  0   0,67
```

A2 sozinho poria P3 acima de P1, e A1 e A3 empatam P2 com P3. A2 também dá 0 a P4, ou seja, não concorda que seja um problema, e esse é o tipo de discordância a discutir: pode ser a troca descrita antes. As médias dão uma ordem, mas uma diferença de 0,33 entre três notas é pouca, então P3 e P2 são mais bem lidos como o mesmo patamar. Nielsen liga o nível 4 a corrigir antes do lançamento e admite que um lançamento só com problemas cosméticos possa seguir.

## Equívocos Comuns e Armadilhas

- **"Cinco avaliadores acham 75%."** Isso é aproximadamente a Figura 2, média de seis estudos. Projetos isolados variam, e a fórmula diz outra coisa (Exemplo 1).
- **"As dez heurísticas são de 1990."** As nove são. As dez vêm de 1994, e as frases de hoje na NN/g foram reescritas em 2020.
- **"A severidade vem junto com a avaliação."** É uma escala à parte, e Nielsen sugere atribuí-la depois das sessões.
- **"Toda violação precisa ser corrigida."** Moran e Gordon dizem o contrário, enquanto Nielsen alerta para não apostar que seu design é uma das raras exceções.
- **"Substitui o teste com usuários."** Cada método acha coisas que o outro perde, e problemas específicos de domínio podem ser quase impossíveis de achar sem usuários. Os estudos CUE relatam que inspeções feitas por especialistas chegaram a qualidade comparável à de testes de usabilidade no CUE-4, e também que times profissionais independentes muitas vezes não reproduzem os resultados uns dos outros.
- **"Três a cinco é uma lei."** É a melhor razão para um modelo de custo (Exemplo 2).

## Resumo

Nove heurísticas apareceram em 1990, dez em 1994, depois de uma análise fatorial de 249 problemas, e a NN/g as reescreveu em 2020. Severidade é uma escala à parte de 0 a 4, mais bem coletada depois das sessões, com vários avaliadores. O método pede inspeção independente, cada problema listado com sua heurística e agregação só no fim. A fórmula de Nielsen e Landauer supõe uma taxa de detecção única para avaliadores e problemas, e com a taxa média ela exagera a curva medida pelo próprio Nielsen. Quatro avaliadores é a melhor razão benefício/custo de um projeto de amostra, e a resposta se move com a taxa de detecção, os custos e o objetivo. Um achado é uma previsão, e uma violação pode ser uma troca justificada, então a avaliação heurística complementa a observação de usuários e não a substitui.

## Documentation Links

- [NN/g: 10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/): a redação atual, datada de 24 de abril de 1994, revisada em 30 de janeiro de 2024, com a nota de Nielsen sobre a história.
- [Nielsen (1994): The Theory Behind Heuristic Evaluations](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/theory-heuristic-evaluations/): o procedimento, a fórmula, a curva de seis estudos e o exemplo de custo-benefício.
- [Moran and Gordon (2023): How to Conduct a Heuristic Evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/): o guia atual, passo a passo, e a troca do menu hambúrguer.
- [Nielsen (1994): Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/): a escala de 0 a 4 e como coletar as notas.
- [Nielsen: Characteristics of Usability Problems Found by Heuristic Evaluation](https://www.nngroup.com/articles/usability-problems-found-by-heuristic-evaluation/): detecção de problemas maiores e menores, e alternância com testes com usuários.
- [Molich: Molich and Nielsen's heuristics (1990)](https://www.dialogdesign.dk/molich-and-nielsens-heuristics-1990/): as nove heurísticas originais.
- [Molich: Nielsen's heuristics (1994)](https://www.dialogdesign.dk/nielsens-heuristics-1994/): as dez heurísticas, numa redação que difere da atual da NN/g.
- [Molich: CUE studies](https://www.dialogdesign.dk/cue-studies/): avaliações comparativas de reprodutibilidade entre times profissionais.
- [Sauro (2010): A Brief History of the Magic Number 5](https://measuringu.com/five-history/): linha do tempo do debate sobre tamanho de amostra, incluindo as estimativas infladas.
