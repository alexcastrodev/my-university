---
version: 1.0
updatedAt: 2026-11-03
title: "Métricas de Qualidade de Software"
summary: "Densidade de defeitos, churn, complexidade ciclomática, cobertura e as cinco métricas de entrega do DORA: o que cada uma pode e não pode dizer, com cálculos resolvidos para densidade, complexidade e métricas do DORA, e por que qualquer uma delas se degrada quando vira meta (a lei de Goodhart, citada com precisão)."
---
## Objetivos de Aprendizagem

- Definir densidade de defeitos, churn de código, complexidade ciclomática, cobertura de testes e as cinco métricas atuais de entrega do DORA, e calcular à mão, com dados pequenos, a densidade de defeitos, a complexidade ciclomática e as métricas do DORA.
- Dizer, para cada métrica, o que ela pode e o que não pode informar, com um caso resolvido em que ela engana para densidade, complexidade e cobertura.
- Citar a lei de Goodhart com precisão, inclusive o fato de que a formulação popular não é de Goodhart.
- Escolher e combinar métricas como sinais para um time aprender, não como metas contra as quais o time é ranqueado.

## Contexto e Motivação

`process-maturity-cmm-cmmi-and-what-came-after` terminou com uma afirmação e uma lacuna: classificações de processo dizem pouco sobre o produto, e parte da prática olha para resultados observáveis. Esta lição cobre as medidas em si. Cada uma é um proxy: densidade de defeitos para "quão bugado", complexidade para "quão difícil de mudar", cobertura para "quão bem testado", métricas de entrega para "quão bem o time entrega". Um proxy só é útil enquanto o vínculo com a coisa real se sustenta, e a habilidade principal aqui é saber quando ele se rompe.

Os requisitos mensuráveis de `the-iso-iec-25010-quality-model` dizem que qualidade você precisa; estas métricas dão evidência parcial de que você a tem. Nenhuma é, ela mesma, uma característica de qualidade.

## Teoria Central

### Densidade de defeitos

Densidade de defeitos é o número de defeitos encontrados dividido pelo tamanho, em geral por mil linhas de código (KLOC). Ela normaliza pelo tamanho, já que um módulo grande naturalmente tem mais defeitos. Suas fraquezas estão nos dois termos. O numerador conta defeitos encontrados, o que depende de quanto alguém procurou; um módulo que ninguém testa tem densidade baixa. O denominador varia com linguagem e estilo. Compare densidades só entre código parecido, sob esforço de teste parecido, na mesma janela de tempo.

### Churn de código

Churn mede quanto um componente mudou num período. Nagappan e Ball (Microsoft Research, 2005) o estudaram em um estudo de caso do Windows Server 2003. O resumo do artigo relata que medidas absolutas de churn são maus preditores de densidade de defeitos, enquanto um conjunto de medidas relativas de churn é altamente preditivo, discriminando binários propensos e não propensos a falhas com acurácia de 89,0%. Essa é a afirmação que o resumo sustenta: um sistema grande e uma associação preditiva. Ela não mostra que o churn causa defeitos.

### Complexidade ciclomática

A complexidade ciclomática conta caminhos independentes em um módulo. A NIST Special Publication 500-235 a define como e - n + 2, em que e e n são as arestas e os nós do grafo de fluxo de controle. Quando todas as decisões são binárias e há p predicados de decisão, ela vale p + 1. O relatório apresenta o argumento para um limite de 10, dizendo que módulos excessivamente complexos são mais propensos a erro e mais difíceis de entender, testar e modificar, e também diz que o limite exato "continua um tanto controverso": o 10 original de McCabe tem evidência a favor e limites de até 15 foram usados com sucesso. Descreve ainda um estudo de validação cujo melhor limiar para prever erros foi bem menor, e observa que McCabe recomendou originalmente isentar um módulo formado por uma única decisão de múltiplas vias (um `switch` ou `case`).

### Cobertura de testes

Cobertura é a parcela do código executada por uma rodada de testes. O post "Code Coverage Best Practices" (2020), do blog de testes do Google, diz bem o limite: cobertura "não garante que as linhas ou ramos cobertos foram testados corretamente, apenas que foram executados por um teste", enquanto um número baixo mostra que grandes áreas estão sem teste. Diz que não há número ideal para todos os produtos, oferece 60% como "aceitável", 75% como "louvável" e 90% como "exemplar" em diretrizes gerais, evitando mandatos amplos de cima para baixo, e alerta que engenheiros podem tratar uma meta como checklist. Sugere teste de mutação como forma melhor de checar se os testes afirmam alguma coisa.

### Métricas de entrega: as cinco do DORA

O guia do DORA lista cinco métricas de entrega de software em dois grupos. Vazão (throughput): change lead time (tempo para uma mudança ir do commit no controle de versão até estar em produção), deployment frequency (deploys em um período, ou o tempo entre eles) e failed deployment recovery time (tempo para se recuperar de um deploy que falha e exige intervenção imediata). Instabilidade: change fail rate (proporção de deploys que exigem intervenção imediata) e deployment rework rate (proporção de deploys não planejados que acontecem por causa de um incidente em produção).

Essa lista mudou. A página de história do DORA diz que a pesquisa inicial usava quatro variáveis (deployment frequency, lead time, mean time to recover, change fail rate). Em 2018 acrescentou-se disponibilidade, que em 2021 virou confiabilidade, a qual o DORA diz medir mais o desempenho operacional que o de entrega. Em 2023 o MTTR foi renomeado para failed deployment recovery time, passando a contar só falhas causadas por uma mudança de software. A deployment rework rate foi introduzida no relatório de 2024. Qualquer fonte que fale em "as quatro métricas do DORA" descreve o conjunto antigo. `continuous-delivery-and-continuous-deployment` cobre as práticas que essas métricas observam.

### A lei de Goodhart, citada com precisão

A frase do próprio Goodhart, de 1975, em um artigo sobre política monetária do Reino Unido, é: "Qualquer regularidade estatística observada tenderá a colapsar quando se exerce pressão sobre ela para fins de controle." A versão popular, "quando uma medida vira meta, deixa de ser uma boa medida", é a paráfrase de Marilyn Strathern (1997, European Review 5(3)) da formulação de Keith Hoskin (1996), "toda medida que vira meta vira uma medida ruim". Essas atribuições seguem o artigo da Wikipedia sobre a lei de Goodhart, uma fonte secundária. O DORA aplica a ideia diretamente: seu guia avisa que definir uma métrica como objetivo convida à manipulação, que uma métrica sozinha é uma armadilha e que as métricas servem para um time melhorar em relação ao próprio passado, não para competir com outros times.

## Exemplos Resolvidos

### Exemplo 1: a densidade inverte o ranking

O módulo `billing` tem 42 defeitos em 28,0 KLOC; o módulo `search` tem 9 defeitos em 3,0 KLOC. Pela contagem, billing é o problema. Pela densidade, billing tem 1,5 defeito por KLOC e search tem 3,0, o dobro. O valor agregado, 51 defeitos em 31,0 KLOC, dá 1,65 por KLOC e não descreve nenhum dos dois módulos. Se search é realmente pior ainda depende do esforço de teste que achou seus defeitos, que o número não contém.

### Exemplo 2: contando complexidade, e o que dividir faz

```python
def classify(orders):
    total = 0
    for o in orders:
        if o.qty <= 0:
            continue
        if o.priority:
            total += 2 * o.qty
        else:
            total += o.qty
    if total > 100:
        return "bulk"
    return "normal"
```

Há quatro predicados de decisão (um `for`, três `if`), então v = 4 + 1 = 5. Montando o grafo de fluxo de controle à mão, dá 14 arestas e 11 nós (com um nó de saída), e 14 - 11 + 2 = 5, a mesma resposta. Agora divida a função em `subtotal` (v = 3), `weight` (v = 2) e `classify` (v = 2). Cada função ficou mais simples, mas somam 7, porque cada função extra acrescenta um. Um limite por função passa enquanto a complexidade total subiu. E uma cadeia de doze testes `if`/`elif` tem v = 13, acima do limite de 10, embora seja uma consulta trivial. Escrita como um único `switch`, essa forma é o tipo de módulo para o qual McCabe recomendou originalmente uma isenção.

### Exemplo 3: 100% de cobertura e um bug que passa

```python
def discount(price, is_member):
    rate = 0.1 if is_member else 0.0
    return price * (1 - rate)
```

Um teste que só chama `discount(100, True)` e afirma 90 reporta 100% de cobertura (3 de 3 comandos) com coverage.py 7.17.1 em modo de ramos, porque a expressão condicional está em uma única linha e seus dois resultados não são contados como ramos separados. Um teste que chama a função e não afirma nada reporta os mesmos 100%. Agora mude a taxa de visitante de 0.0 para 0.2. Os dois testes continuam passando. Só um teste que também afirma `discount(100, False) == 100` falha. Mude a taxa de membro para 0.5 e o teste sem asserção ainda passa.

Aplique agora Goodhart: um mandato de "cobertura de pelo menos 80%" é cumprido igualmente por testes sem asserção, que mexem no número e em nada na segurança. O número pode subir sem o código ficar mais seguro, que é o padrão que a lei de Goodhart descreve.

### Exemplo 4: calculando as cinco do DORA a partir de um log

Dez deploys entre 1 e 22 de outubro. Os change lead times (do commit à produção), em horas: 6,0, 73,0, 20,0, 2,0, 30,5, 25,0, 21,5, 26,0, 30,0, 22,0. A mediana é 23,5 horas e a média é 25,6; a mediana é menos puxada pelo outlier de 73 horas. Dez deploys em cerca de três semanas dão aproximadamente 3,3 por semana. Dois deploys exigiram intervenção imediata, então a change fail rate é 2 de 10, ou 20%, com tempos de recuperação de 95 e 40 minutos, mediana de 67,5 minutos. Mais um deploy foi uma correção não planejada feita por causa de um incidente em produção, então a deployment rework rate é 1 de 10, ou 10%. Com duas falhas, a mediana de recuperação quase não significa nada como estatística. Dez linhas demonstram a aritmética, não servem para julgar um time, e o DORA diz que as métricas valem para uma aplicação ou serviço, não para sistemas misturados ou comparados.

## Equívocos Comuns e Armadilhas

- **"A lei de Goodhart diz 'quando uma medida vira meta, deixa de ser uma boa medida'."** Essa redação é a paráfrase de Strathern de 1997. A frase de Goodhart trata de regularidades estatísticas que colapsam sob pressão de controle.
- **"As quatro métricas do DORA."** O conjunto é de cinco desde 2024, e uma das quatro originais foi renomeada em 2023.
- **"100% de cobertura significa que o código está testado."** Significa que toda linha foi executada. O Exemplo 3 mostra um bug passando com 100%.
- **"Menor complexidade por função significa um sistema mais simples."** O Exemplo 2 mostra que o total pode subir quando se divide uma função.
- **"Comparar times pelas métricas de entrega."** O DORA diz que o objetivo é o time melhorar em relação ao próprio passado.

## Resumo

Densidade de defeitos, churn, complexidade ciclomática, cobertura e as métricas de entrega do DORA são proxies, cada um com um jeito conhecido de enganar: a densidade depende de esforço de teste e de tamanho, o churn absoluto prevê mal onde o relativo prevê bem, limites de complexidade são debatidos e podem ser contornados dividindo funções, e a cobertura mostra execução, não verificação. O conjunto atual do DORA tem cinco métricas (três de vazão, duas de instabilidade) após uma renomeação em 2023 e uma adição em 2024. As palavras do próprio Goodhart tratam de regularidades que colapsam sob pressão de controle; a formulação mais famosa é de Strathern. Use métricas como vários sinais que um time lê sobre o próprio trabalho, não como metas ou rankings.

## Documentation Links

- [DORA: software delivery performance metrics](https://dora.dev/guides/dora-metrics/): as cinco métricas atuais com suas definições, e os próprios avisos do DORA sobre metas, métrica única e comparação entre times.
- [DORA: a history of DORA's software delivery metrics](https://dora.dev/insights/dora-metrics-history/): como o conjunto cresceu a partir de quatro variáveis, incluindo a nota de 2021 sobre confiabilidade, a renomeação de 2023 e a rework rate de 2024.
- [NIST SP 500-235: Structured Testing, A Testing Methodology Using the Cyclomatic Complexity Metric](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf): a definição de complexidade ciclomática, o atalho p + 1 e a discussão do limite de 10.
- [Nagappan and Ball (2005): Use of Relative Code Churn Measures to Predict System Defect Density](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/): o estudo do Windows Server 2003 sobre churn absoluto versus relativo.
- [Google Testing Blog: Code Coverage Best Practices (2020)](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html): o que a cobertura garante e não garante, e a posição do Google sobre metas de cobertura.
- [Wikipedia: Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law): um resumo secundário usado para as citações de Goodhart (1975), Strathern (1997) e Hoskin (1996), a conferir contra os originais.
