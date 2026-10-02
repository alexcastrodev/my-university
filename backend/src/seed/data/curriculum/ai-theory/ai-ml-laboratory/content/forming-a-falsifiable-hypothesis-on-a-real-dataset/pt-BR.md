---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Formulando uma Hipótese Falseável sobre um Dataset Real"
summary: Este lab abre o segundo arco desta disciplina, aplicando o framework de hipóteses e evidências de `graduate-studies/research-statistics` a um cenário de ML genuinamente prático. Não basta um dataset real; é preciso uma pergunta real e ainda em aberto sobre ele, refinada, exatamente como descreve Hipóteses, Perguntas e Formas de Evidência, em uma afirmação específica e falseável (o sinal do coeficiente de uma feature, um limiar específico de acurácia que o modelo do Lab 1 deve superar) antes mesmo de começar o trabalho com o dataset do Lab 6 ou a seleção de modelo do Lab 7. Assim, cada lab seguinte deste arco responde a uma pergunta declarada com precisão suficiente, com antecedência, para que possa de fato estar errada.
---
## Objetivos de Aprendizagem

- Aplicar o framework de hipótese falseável de `graduate-studies/research-statistics` a uma pergunta real e não resolvida sobre um dataset real, antes de qualquer ajuste de modelo começar.
- Distinguir uma ideia vaga de projeto de ML de uma hipótese específica o bastante para que um experimento concreto possa refutá-la.
- Declarar, com antecedência, que evidência contaria como apoio e que evidência contaria como refutação da hipótese escolhida.
- Explicar por que formular a hipótese antes de mexer em seleção de modelo ou avaliação importa para a honestidade de todos os labs seguintes deste arco.

## Contexto e Motivação

Os Labs 1 a 4 construíram um kit de ferramentas real (regressão linear e logística, uma pequena rede neural, k-means e PCA), cada um verificado contra sua própria checagem independente de correção. Este lab abre o segundo arco desta disciplina, e seu primeiro movimento, de propósito, não é técnico: formular uma hipótese real e falseável, exatamente como o conceito `hypotheses-questions-and-forms-of-evidence` de `graduate-studies/research-statistics` a define, sobre um dataset real escolhido, antes de começar qualquer parte do trabalho com o dataset do Lab 6 ou da seleção de modelo do Lab 7.

## Teoria Central

Nada sobre *por que* uma hipótese precisa ser falseável, ou sobre quais formas de evidência podem apoiá-la ou refutá-la, é derivado de novo aqui; esse argumento já existe por completo em `hypotheses-questions-and-forms-of-evidence`. Este lab é a disciplina de aplicar esse framework já estabelecido especificamente a um projeto de machine learning, em que a tentação de pular direto para o ajuste de modelos sem uma pergunta precisa em mãos é uma versão real, comum e com sabor bem de ML do problema de vagueza contra o qual aquele conceito já alerta.

## Exemplos Resolvidos

### De uma ideia vaga de ML a uma hipótese falseável

```text
Ideia vaga:         "Quero construir um modelo que preveja preços de imóveis."
                    (Não falseável: quase qualquer modelo, por pior que
                    seja, tecnicamente "prevê" alguma coisa; nada aqui
                    especifica o que contaria como o modelo falhar.)

Refinada uma vez:   "Um modelo usando metragem, localização e idade
                    deve prever o preço do imóvel razoavelmente bem."
                    (Ainda vaga: o que conta como "razoavelmente bem"?)

Hipótese
falseável:          "Um modelo linear regularizado treinado com
                    metragem, localização e idade atinge R² de pelo
                    menos 0,7 no conjunto retido de [este dataset real
                    específico], superando um baseline que prevê a
                    média em pelo menos 0,5."
```

A versão final especifica uma métrica exata, um limiar exato, um baseline de comparação exato e um dataset exato, e é isso que a torna falseável: um resultado experimental específico e concreto, executado no Lab 8, poderia mostrar que essa afirmação é falsa, e não apenas decepcionante.

### Passo 1: escolhendo uma pergunta real e ainda em aberto sobre o dataset escolhido

```text
Dataset: um dataset real e publicamente disponível (não dados sintéticos
gerados especificamente para tornar a hipótese trivialmente verdadeira
ou falsa).

A pergunta que este lab exige NÃO é "este dataset existe" nem "dá para
ajustar um modelo a ele" (as duas trivialmente verdadeiras), mas algo
genuinamente incerto de antemão: uma feature específica realmente
carrega sinal preditivo, uma classe de modelo específica supera um
baseline mais simples específico por uma margem significativa, uma
escolha específica de pré-processamento muda o resultado.
```

### Passo 2: declarando, explicitamente, que evidência refutaria a hipótese

```text
Hipótese:  "A regularização (Ridge, de model-selection-and-the-
           bias-variance-tradeoff-measured) melhora o R² retido deste
           modelo em pelo menos 0,03 em comparação com a versão não
           regularizada, no split retido deste dataset específico."

REFUTARIA:  o R² retido melhora menos de 0,03, ou piora.

SUSTENTARIA:  o R² retido melhora 0,03 ou mais, medido com honestidade
              em dados que o modelo nunca viu durante o ajuste nem
              durante a seleção de hiperparâmetros (a disciplina exata
              que o PRÓXIMO lab, dataset-work-splits-leakage-and-
              honest-evaluation, foi construído para garantir).
```

### Passo 3: uma declaração escrita da hipótese, o entregável real do lab

```text
DECLARAÇÃO DA HIPÓTESE (a saída real deste lab):

Dataset: [nome, fonte, tamanho]
Pergunta: [a pergunta específica e ainda em aberto que motiva este projeto]
Hipótese: [a afirmação falseável exata, com métrica, limiar
           e baseline nomeados explicitamente]
Evidência que a refutaria: [declarada explicitamente, com antecedência]
Evidência que a sustentaria: [declarada explicitamente, com antecedência]
```

### Passo 4: por que escrever isto ANTES de ajustar qualquer modelo importa

```text
Sem uma hipótese escrita com antecedência, um modo de falha comum e
real é: ajustar vários modelos, perceber que um deles por acaso tem
bom desempenho em ALGUMA métrica e, retroativamente, enquadrar essa
métrica como a que "importava" desde o início; uma forma sutil e fácil
de cair da violação de escopo honesto contra a qual
good-and-bad-science-measurement-and-reflection já alerta, específica de
projetos de ML, em que muitas métricas e muitas variantes de modelo são
baratas de testar.

Escrever a hipótese, incluindo a métrica e o limiar ESPECÍFICOS, antes
mesmo de começar o trabalho com o dataset do Lab 6, é o que evita isso.
```

## Equívocos Comuns e Armadilhas

- **"Uma hipótese para um projeto de ML deveria ser só 'este modelo vai funcionar bem'."** Essa é exatamente a forma vaga e não falseável da qual o exemplo do Passo 1 parte e que ele refina de propósito; sem uma métrica, um limiar e um baseline específicos, nenhum resultado experimental poderia de fato refutar a afirmação, o que significa que ela nunca foi uma hipótese real.
- **"Não tem problema decidir a hipótese depois de ver o desempenho dos modelos, desde que o relatório final seja preciso."** Esse é justamente o modo de falha que o Passo 4 descreve: escolher qual métrica "importava" depois de já ter visto os resultados torna quase impossível não favorecer inconscientemente o enquadramento que faz os resultados reais parecerem melhores, e é por isso que a hipótese é escrita, de forma específica e completa, antes de qualquer modelo deste arco ser treinado no dataset real.
- **"Este passo é burocracia que não muda de verdade o código que é escrito."** Ele muda o que o experimento do Lab 8 está de fato testando: um lab que começa com uma hipótese precisa tem uma resposta real e predeterminada para "isso funcionou?", enquanto um lab que começa só treinando modelos e olhando os resultados depois não tem essa resposta, apenas uma história construída a posteriori sobre o número que acabou parecendo bom.

## Resumo

Este lab abre o segundo arco desta disciplina aplicando o framework de hipótese falseável de `hypotheses-questions-and-forms-of-evidence` diretamente a um dataset real escolhido: refinando uma ideia vaga de projeto de ML em uma afirmação específica e falseável, que nomeia uma métrica, um limiar e um baseline de comparação exatos, e declarando explicitamente, com antecedência, que evidência a sustentaria ou a refutaria. Fazer isso antes de começar qualquer parte do trabalho com o dataset do Lab 6 ou da seleção de modelo do Lab 7 é o que evita um modo de falha real e comum, específico de projetos de ML: decidir retroativamente qual métrica "importava" só depois de já ter visto qual delas faz os resultados parecerem melhores.

## Documentation Links

- [ACM Digital Library: Justin Zobel, Writing for Computer Science (3rd Edition, Springer, 2014)](https://dl.acm.org/doi/10.5555/2742708): a fonte do framework de hipótese falseável que este lab aplica diretamente a um projeto real de machine learning.
