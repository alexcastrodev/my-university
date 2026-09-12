---
version: 1.0
updatedAt: 2026-09-06
title: "A Distribuição Normal"
summary: "N(μ, σ²) é simétrica e determinada por média e desvio padrão; a regra empírica 68-95-99,7 dá estimativas rápidas sem tabela, e padronizar via Z = (X−μ)/σ converte qualquer Normal na Normal padrão para uso de uma única tabela Z."
---
## Objetivos de Aprendizagem

- Declarar a FDP da distribuição Normal N(μ, σ²) e identificar o papel de μ (centro) e σ (dispersão) em sua forma.
- Aplicar a regra empírica 68-95-99,7 para estimar probabilidades sem uma tabela Z.
- Padronizar qualquer variável aleatória Normal via Z = (X − μ)/σ e usar uma tabela Z (ou sua simetria) para computar probabilidades.
- Explicar, num nível de prévia, por que a distribuição Normal aparece tão amplamente em fenômenos naturais e estatísticos.
- Reconhecer a simetria da distribuição Normal e usá-la para computar probabilidades para valores abaixo da média sem rederivá-las do zero.

## Contexto e Motivação

Abra quase qualquer conjunto de dados de medições ocorrendo naturalmente (alturas de humanos adultos, erros de medição num experimento de física, notas de teste padronizado, leituras de pressão arterial), e, plotados como um histograma, um número extraordinário deles se estabelece na mesma forma inconfundível de sino: um único pico no centro, caindo simetricamente e suavemente nos dois lados, com valores extremos se tornando rapidamente mais raros quanto mais longe do centro estejam. Essa forma é a **distribuição Normal** (também chamada **distribuição Gaussiana**, em homenagem a Carl Friedrich Gauss, embora tenha sido estudada independentemente por outros), e é, sem competição séria, a distribuição contínua mais importante de toda a probabilidade e estatística. Tanto o CS109 de Stanford quanto o Stat 110 de Harvard tratam a distribuição Normal como um tópico essencial exatamente por essa razão: uma fração extraordinária da estatística aplicada (intervalos de confiança, testes de hipótese, gráficos de controle de qualidade, pontuação padronizada) é construída diretamente sobre a maquinaria da distribuição Normal.

Vale a pena ser direto sobre *por que* a distribuição Normal aparece com tanta insistência através de domínios tão amplamente diferentes, mesmo que a explicação completa seja o próximo conceito deste curso: o **Teorema Central do Limite**. A prévia curta é que quando uma quantidade resulta de somar muitos efeitos pequenos, independentes e aproximadamente comparáveis (altura humana de incontáveis fatores genéticos e ambientais, um erro de medição de incontáveis fontes minúsculas de ruído, uma nota de exame de incontáveis perguntas respondidas individualmente), a *soma* de todos esses efeitos tende à forma Normal quase automaticamente, independentemente de como qualquer efeito individual parecia sozinho. Esse é um fato matemático genuinamente profundo e útil, e este conceito deliberadamente monta todo o vocabulário e mecânica (a FDP, a regra empírica, padronização) necessários para declarar e usar aquele teorema de forma limpa uma vez que é introduzido apropriadamente.

Por ora, trate a distribuição Normal como uma forma conhecida e extremamente bem estudada: uma distribuição completamente caracterizada por exatamente dois parâmetros, sua média μ e seu desvio padrão σ, que juntos ditam tudo sobre onde está centrada e quão espalhada está.

## Teoria Central

### A FDP Normal

Uma variável aleatória contínua X é **distribuída Normalmente** com média μ e variância σ², escrito X ~ N(μ, σ²), se sua função densidade de probabilidade é

f(x) = (1 / (σ√(2π))) · e^(−(x − μ)² / (2σ²))

para todo x real. Esta fórmula é declarada aqui, não derivada; derivá-la a partir de princípios básicos exige ferramentas além dos pré-requisitos deste curso, mas sua forma vale a pena ler cuidadosamente mesmo sem uma derivação. O expoente é um múltiplo negativo de (x − μ)², que é zero exatamente em x = μ e cresce sem limite conforme x se afasta de μ em qualquer direção; como o expoente carrega um sinal negativo, f(x) é *maior* em x = μ (onde o expoente é 0, dando e⁰ = 1) e encolhe rapidamente, simetricamente, nos dois lados. O parâmetro σ controla quão rapidamente esse encolhimento acontece: um σ pequeno produz um pico alto e estreito concentrado firmemente ao redor de μ, enquanto um σ grande produz uma curva baixa, larga e espalhada. A constante na frente, 1/(σ√(2π)), existe puramente para fazer a área total sob a curva ser igual a exatamente 1, como qualquer FDP válida exige.

```mermaid
graph LR
    subgraph "Efeito de sigma em N(mu, sigma^2), mesmo mu"
        A["sigma pequeno:<br/>pico alto e estreito"]
        B["sigma grande:<br/>dispersão baixa e larga"]
    end
```

Dois fatos estruturais decorrem diretamente da fórmula e valem a pena declarar explicitamente: a curva é perfeitamente simétrica em torno de x = μ (já que (x − μ)² não é afetado ao inverter o sinal de x − μ), e μ é simultaneamente a média, a mediana, e a moda da distribuição, o ponto de maior densidade, o ponto dividindo a área exatamente ao meio, e a média de longo prazo, todos coincidem, uma consequência daquela simetria.

### A regra empírica 68-95-99,7

Para qualquer variável aleatória Normal, independentemente dos valores específicos de μ e σ, a seguinte regra aproximada sempre vale, medindo distância da média em unidades de desvio padrão:

- Cerca de 68% da massa de probabilidade está dentro de 1σ de μ, isto é, P(μ − σ ≤ X ≤ μ + σ) ≈ 0,68.
- Cerca de 95% está dentro de 2σ de μ, isto é, P(μ − 2σ ≤ X ≤ μ + 2σ) ≈ 0,95.
- Cerca de 99,7% está dentro de 3σ de μ, isto é, P(μ − 3σ ≤ X ≤ μ + 3σ) ≈ 0,997.

Isso se chama a **regra empírica** (ou "regra 68-95-99,7"), e seu enorme valor prático é que permite estimar probabilidades para qualquer distribuição Normal instantaneamente, sem consultar uma tabela ou fazer qualquer cálculo, contanto que a pergunta seja frasada em termos de desvio padrão inteiro. Também dá um senso imediato e intuitivo de escala: uma observação a mais de 3 desvios padrão da média é um evento genuinamente raro sob um modelo Normal (aproximadamente 0,3% de chance no total, dividido entre as duas caudas), que é precisamente por que "evento de 3-sigma" entrou no uso comum como abreviação para algo incomum.

### Padronização: o escore Z e a Normal padrão

Como toda distribuição Normal tem a mesma forma subjacente, só esticada e deslocada por μ e σ, qualquer variável aleatória Normal pode ser convertida numa distribuição de referência comum por uma transformação linear chamada **padronização**:

Z = (X − μ)/σ

Se X ~ N(μ, σ²), então Z ~ N(0, 1), a **distribuição Normal padrão**, com média 0 e desvio padrão 1. Isso funciona porque subtrair μ recentraliza a distribuição em 0, e dividir por σ a reescala de forma que uma unidade de Z corresponda a exatamente um desvio padrão do X original. O valor da padronização é que uma única tabela de probabilidades para N(0, 1), uma **tabela Z**, basta para responder perguntas de probabilidade para *qualquer* distribuição Normal, não importa seu μ e σ: converta os valores extremos de interesse para escores Z primeiro, depois busque (ou compute) a probabilidade Normal padrão correspondente.

Como a Normal padrão é simétrica em torno de 0, um atalho útil decorre diretamente: P(Z ≤ −z) = P(Z ≥ z) para qualquer z ≥ 0, então uma tabela Z que só lista probabilidades para valores z positivos não está de fato faltando nada; probabilidades de z negativo são obtidas subtraindo a probabilidade de z positivo de 1, ou por simetria diretamente.

## Exemplos Resolvidos

### Exemplo 1: aplicando a regra empírica diretamente

**Problema:** a altura de homens adultos numa população é modelada como Normal com μ = 175 cm e σ = 7 cm. Estime a probabilidade de um homem selecionado aleatoriamente ter entre 161 cm e 189 cm de altura, e separadamente, a probabilidade de ele ter mais de 196 cm.

**Primeiro intervalo.** 161 = 175 − 2(7) e 189 = 175 + 2(7), então esse intervalo é exatamente [μ − 2σ, μ + 2σ]. Pela regra empírica, P(161 ≤ X ≤ 189) ≈ 0,95.

**Segundo intervalo.** 196 = 175 + 3(7) = μ + 3σ. A regra empírica declara P(μ − 3σ ≤ X ≤ μ + 3σ) ≈ 0,997, então a probabilidade de estar *fora* dessa faixa (em qualquer cauda) é cerca de 1 − 0,997 = 0,003, dividida simetricamente entre as duas caudas. Então P(X > 196) ≈ 0,003/2 = 0,0015, um evento genuinamente raro, correspondendo à intuição de que ser mais alto que μ + 3σ deveria ser incomum.

### Exemplo 2: padronizando para usar uma tabela Z

**Problema:** usando o mesmo modelo de altura X ~ N(175, 7²), encontre P(X ≤ 180) (sem depender da regra empírica, já que 180 não cai num múltiplo inteiro de σ).

**Padroniza.** Z = (X − μ)/σ = (180 − 175)/7 ≈ 0,71.

**Reduz à Normal padrão.** P(X ≤ 180) = P(Z ≤ 0,71). Buscar esse valor numa tabela Z padrão dá aproximadamente 0,7611.

**Interpretação.** Cerca de 76,1% dos homens nessa população têm 180 cm de altura ou menos, um valor entre 0,5 (a probabilidade de estar abaixo da média, 175) e 0,977 (abaixo de μ + 2σ = 189, pela regra empírica), que é exatamente a faixa certa já que 180 fica mais perto de μ do que de μ + 2σ. Essa checagem cruzada contra a regra empírica é um bom hábito: uma resposta amplamente fora da faixa que a regra empírica sugere é um sinal de erro aritmético.

### Exemplo 3: indo na direção oposta: encontrando um valor de corte

**Problema:** um exame padronizado tem notas modeladas como X ~ N(500, 100²). Que nota é necessária para estar nos 10% melhores dos participantes?

**Reformula em termos de Z.** "10% melhores" significa encontrar um corte c tal que P(X ≥ c) = 0,10, equivalentemente P(X ≤ c) = 0,90, equivalentemente P(Z ≤ z) = 0,90 para o escore z correspondente.

**Busca o valor Z.** Uma tabela Z (usada ao contrário) mostra que P(Z ≤ 1,28) ≈ 0,90, então z ≈ 1,28.

**Desfaz a padronização.** Como z = (c − μ)/σ, resolve para c: c = μ + z·σ = 500 + 1,28(100) = 500 + 128 = 628.

**Interpretação.** Uma nota de cerca de 628 ou mais coloca um participante nos 10% melhores. Esse padrão de "busca reversa" (ir de uma probabilidade, para um valor Z, para um valor na escala original) é exatamente a mecânica que mais adiante sustenta computar intervalos de confiança.

## Equívocos Comuns e Armadilhas

- **"A altura do pico da FDP Normal é a probabilidade da média."** Como com toda distribuição contínua, P(X = μ) = 0 exatamente; a altura 1/(σ√(2π)) no pico é um valor de densidade, não uma probabilidade, e pode exceder 1 para σ pequeno (por exemplo, σ = 0,1 dá uma altura de pico ao redor de 3,99). Só áreas sob trechos da curva são probabilidades.
- **"A regra empírica é uma lei exata, sempre dando exatamente 68%, 95%, 99,7%."** É uma aproximação; os valores verdadeiros estão mais próximos de 68,27%, 95,45%, e 99,73%, e se aplica especificamente a distribuições Normais (ou extremamente próximas de Normal); aplicar "68-95-99,7" a uma distribuição que não é aproximadamente Normal (por exemplo, fortemente assimétrica) dá números sem sentido.
- **"Escores Z só fazem sentido para distribuições Normais."** Padronização, Z = (X − μ)/σ, é uma transformação linear válida para *qualquer* distribuição com média e variância finitas, e sempre produz uma variável com média 0 e variância 1. O que é especial ao caso Normal é que a *distribuição resultante* é ela mesma outra distribuição nomeada (a Normal padrão) cujas probabilidades são tabuladas; para um X não Normal, Z ainda tem média 0 e variância 1, mas sua forma é qualquer que fosse a forma da distribuição original, e uma tabela Z não se aplica a ela.
- **"Um escore Z negativo significa que algo deu errado."** Um escore Z negativo simplesmente significa que a observação está abaixo da média, inteiramente esperado para aproximadamente metade de todas as observações. Z = −1,5, por exemplo, só significa "1,5 desvios padrão abaixo da média", não um erro.
- **"Já que N(μ, σ²) tem dois parâmetros, duas distribuições Normais com o mesmo σ mas μ diferente têm formas diferentes."** Elas têm a forma idêntica, só deslocada; mudar μ desliza a curva de sino inteira para a esquerda ou direita sem alterar sua largura ou altura em qualquer posição relativa; só σ muda a forma real (mais estreita ou mais larga).

## Resumo

A distribuição Normal N(μ, σ²) é uma distribuição contínua simétrica e com forma de sino totalmente determinada por sua média μ (centro) e desvio padrão σ (dispersão), com FDP f(x) = (1/(σ√(2π)))·e^(−(x − μ)²/(2σ²)). A regra empírica 68-95-99,7 dá estimativas de probabilidade rápidas e sem tabela para resultados dentro de 1, 2, ou 3 desvios padrão da média. Padronização, Z = (X − μ)/σ, converte qualquer variável Normal na Normal padrão N(0, 1), permitindo que uma única tabela Z responda perguntas de probabilidade para toda combinação possível de μ e σ, e a mesma transformação roda ao contrário para converter uma probabilidade alvo de volta num valor de corte na escala original. A onipresença da distribuição Normal através de tantas medições do mundo real não relacionadas não é coincidência: é uma consequência direta do Teorema Central do Limite, tratado a seguir, que explica por que somas de muitos efeitos independentes tendem exatamente a essa forma.

## Documentation Links

- [Stanford CS109 — Course Schedule](http://web.stanford.edu/class/cs109/schedule.html) — doc
- [Harvard Stat 110 — Course Home](https://stat110.hsites.harvard.edu/) — doc
