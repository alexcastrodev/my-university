---
version: 1.0
updatedAt: 2026-11-04
title: "Lei de Fitts e Lei de Hick"
summary: "Dois modelos preditivos: a lei de Fitts para o tempo de apontar e a lei de Hick para o tempo de escolha, com cálculos sobre tamanhos reais de alvos e menus, e onde cada um deixa de valer."
---
## Objetivos de Aprendizagem

- Enunciar as formulações de Fitts, Welford e Shannon e dizer de quem é cada uma.
- Ajustar $a$ e $b$ por regressão em dados publicados, para um dispositivo e uma tarefa.
- Calcular o índice de dificuldade para tamanhos reais de alvos, separando medido de suposto.
- Enunciar a lei de Hick, suas condições e o efeito de prática e compatibilidade.
- Explicar por que Hick não pede menus curtos e onde cada modelo deixa de valer.

## Contexto e Motivação

`mental-models-and-the-gulfs-of-execution-and-evaluation` descreveu a execução como um estágio da ação. Estes dois modelos medem pedaços dela: o tempo de mirar e o tempo de escolher. Os dois vêm da psicologia experimental dos anos 1950, quando a teoria da informação era nova, e costumam ser esticados. O objetivo é rodá-los direito e saber quando nada dizem.

## Teoria Central

### O experimento de Fitts

Fitts (1954) fez quatro experimentos, dois deles de toque recíproco com estilete (1 oz e 1 lb). Neles, o participante movia o estilete entre duas placas o mais rápido possível, tocando seus centros. Fitts cruzou quatro amplitudes $A$ com quatro larguras $W$. MacKenzie (2018) reproduz os dados resumidos do estilete de 1 oz e informa 16 participantes, com cada média formada por mais de 600 observações.

Fitts definiu um índice de dificuldade em bits, por analogia com a capacidade de canal de Shannon: distância como sinal, largura como ruído. Sua tese era que a taxa $ID/MT$ fica mais ou menos constante.

### Três formulações

| Formulação | Índice de dificuldade | Fonte |
|---|---|---|
| Fitts | $\log_2(2A/W)$ | Fitts (1954) |
| Welford | $\log_2(A/W+0.5)$ | Welford (1960, 1968) |
| Shannon | $\log_2(A/W+1)$ | MacKenzie (1989, 1992), analogia direta com o teorema de Shannon |

Esta lição usa a formulação de Shannon para prever, porque ela não fica negativa para nenhum $A/W$ positivo, ao contrário das outras duas com $A$ pequeno. A equação de predição é

$$MT=a+b\cdot ID,$$

em que $a$ e $b$ vêm de regressão num dispositivo, tarefa e grupo. MacKenzie observa que essa equação não aparece na publicação de 1954: Fitts dividia ID por MT diretamente, e a forma de regressão veio depois. Um intercepto positivo pode absorver custos sem relação com a dificuldade, como apertar um botão. Coeficientes não viajam: seu levantamento de 1992 sobre estudos de dispositivos achou índices de desempenho de 1,1 a 13,7 bits/s e interceptos de $-880$ a $1030$ ms, com discordância até para o mesmo dispositivo.

### Largura efetiva e throughput

O modelo de Fitts supõe tacitamente que 96% dos toques caem no alvo. Quando a taxa de erro difere de 4%, a largura do alvo é trocada por uma largura efetiva $W_e$, que é $4{,}133\times SD$ dos pontos finais. O método da ISO 9241-9, hoje ISO 9241-411, usa isso para relatar **throughput** em bits/s, combinando velocidade e precisão. O throughput mede; a reta de regressão prevê.

### Lei de Hick: fórmula e condições

Hick (1952) e Hyman (1953) estudaram o tempo de reação de escolha. Na forma comum, como dada por Liu e colegas (2020), cuja revisão é a fonte dos detalhes experimentais abaixo,

$$T=a+b\cdot H,\qquad H=\log_2 n\ \text{ (equiprováveis)},\qquad H=\sum_{i=1}^n p_i\log_2\frac{1}{p_i}.$$

A versão do livro de Card e colegas usa $\log_2(n+1)$. Os experimentos do próprio Hick favoreceram o $+1$, que responde pela incerteza sobre se um estímulo vai ocorrer. Esta lição usa $\log_2 n$ para $H$ e mostra as duas no Exemplo 3.

O aparato de Hick explica as hipóteses. Dez lâmpadas em círculo irregular acendiam uma ao acaso, a cada 5 segundos, e cada dedo ficava numa chave Morse associada a uma lâmpada. No primeiro experimento, Hick foi o único participante, depois de mais de 8.000 tentativas de treino. Hyman variou a entropia pelo número de estímulos, por suas probabilidades e por dependências sequenciais. A lei trata, portanto, de um mapeamento estímulo-resposta aprendido e arbitrário, com um estímulo que chega sem aviso e uma resposta de duração desprezível.

Liu e colegas enunciam o resultado assim: o tempo de reação de escolha numa tarefa simples cresce linearmente com a entropia do estímulo, na faixa de 1 a 4 bits. A inclinação cai com maior compatibilidade estímulo-resposta e com mais treino, e com aprendizado suficiente esses efeitos podem cair quase a zero.

### O que achata a lei de Hick

- **Compatibilidade.** A tarefa de lâmpadas e chaves de Hick deu cerca de 200 ms/bit. Apertar uma tecla que vibra sob o dedo (Leonard) ou ler dígitos em voz alta (Mowbray) praticamente não mostrou efeito da incerteza.
- **Prática.** Knight e Dagnall relataram inclinações caindo de 73 para 23 ms/bit depois de dois meses. Seibel relatou quase nenhuma diferença entre 31 e 1.023 alternativas depois de mais de 75.000 tentativas.
- **Interfaces.** Liu e colegas reanalisaram duas tarefas de seleção com comandos destacados e acharam 32 e 8 ms/bit num tablet e 4 ms/bit com mouse.

Na maioria das interfaces o mapeamento é muito compatível: o alvo é aquilo que se procurava. A conclusão deles é que, em tarefas de IHC, o tempo de reação de escolha muitas vezes pode ser tratado como constante.

### O que a lei de Hick não sustenta

A leitura popular é "mantenha os menus curtos". Liu e colegas argumentam que a lei, tomada ao pé da letra, diz o contrário, porque o logaritmo é côncavo. Dividir $N$ itens em páginas ou categorias custa mais, como roda o Exemplo 4. Eles supõem, para efeito de raciocínio, que a lei se aplica. Pode haver boas razões para menus curtos, mas elas estão em outro lugar, sobretudo na busca visual. Se a pessoa examina os itens um a um, o tempo cresce linearmente com $N$, e esse caso favorece agrupar por categoria.

Curva logarítmica também não implica lei de Hick. Busca hierárquica (Landauer e Nachbar) e rolagem de um menu alfabético (Cockburn e Gutwin) podem ser logarítmicas por uma estratégia de dividir para conquistar.

### Onde cada modelo para

| Situação | Fitts | Hick |
|---|---|---|
| Dedo em alvos de toque pequenos | Fraco: use FFitts (Exemplo 2) | Não é a questão |
| Especialista com atalhos | Silencioso: sem mira, ou sem ponteiro | Inclinação perto de zero com prática |
| Procurar um item | Silencioso: o modelo começa com o alvo já conhecido | Não se aplica: varredura linear não é reação de escolha |
| Movimento lento e cuidadoso | Fraco: modela movimento rápido e dirigido | Não é a questão |
| Alvos muito fáceis | Curva para cima abaixo de ID 3 em alguns dados | Não é a questão |
| Muitas alternativas, acima de 4 bits | Não é a questão | Costuma superestimar; a faixa depende da tarefa |
| Alvos na borda da tela | Mouse ganha, toque não (NN/g, 2022) | Não é a questão |

Células silenciosas são leitura desta lição; as outras vêm das fontes acima.

## Exemplos Resolvidos

### Exemplo 1: regressão nos dados do estilete de 1 oz

Os tempos de movimento vêm de Fitts (1954), tabulados por MacKenzie (2018). Tempos em ms, $A$ e $W$ em polegadas.

```text
 W \ A      2     4     8    16
 0,25     392   484   580   731
 0,50     281   372   469   595
 1,00     212   260   357   481
 2,00     180   203   279   388
```

```python
import numpy as np
from scipy import stats

A = np.array([2, 4, 8, 16] * 4, float)
W = np.repeat([0.25, 0.5, 1, 2], 4)
MT = np.array([392, 484, 580, 731, 281, 372, 469, 595,
               212, 260, 357, 481, 180, 203, 279, 388], float)
We = np.array([.243, .244, .235, .247, .444, .468, .446, .468,
               .725, .812, .914, .832, 1.020, 1.233, 1.576, 1.519])

models = {"Fitts,   W ": np.log2(2 * A / W),
          "Welford, W ": np.log2(A / W + 0.5),
          "Shannon, W ": np.log2(A / W + 1),
          "Fitts,   We": np.log2(2 * A / We),
          "Shannon, We": np.log2(A / We + 1)}
for name, ID in models.items():
    f = stats.linregress(ID, MT)
    print(f"{name}  ID {ID.min():.2f}-{ID.max():.2f}  a={f.intercept:7.2f}"
          f"  b={f.slope:6.2f}  r2={f.rvalue**2:.4f}")
```

```text
Fitts,   W   ID 1.00-7.00  a=  12.80  b= 94.67  r2=0.9664
Welford, W   ID 0.58-6.01  a=  65.36  b=103.79  r2=0.9802
Shannon, W   ID 1.00-6.02  a=  27.69  b=111.54  r2=0.9873
Fitts,   We  ID 1.97-7.02  a= -73.19  b=108.89  r2=0.9814
Shannon, We  ID 1.57-6.04  a= -31.43  b=121.98  r2=0.9877
```

A primeira linha reproduz o $MT=12{,}8+94{,}7\,ID$ de MacKenzie, e a última sua reanálise ($R^2=0{,}9877$). Todas as linhas ajustam as mesmas 16 médias, então a comparação é justa. A melhora está no lado fácil: em $A=W=2$, observados 180 ms, o ajuste de Fitts prevê 107 ms e o de Shannon, 139 ms.

A última linha mostra também uma armadilha. O intercepto é negativo, então a reta chega a tempo zero em $ID\approx0{,}26$ bits. Isso está fora dos dados e alerta contra extrapolar. São números de um estilete de 1954, então nenhum deles prevê um mouse ou um dedo hoje. Dobrar $A/W$ de 8 para 16 acrescenta 0,92 bits, o que custa 102 ms com a inclinação de Shannon. Reduzir $W$ à metade tem o mesmo efeito na fórmula, embora em estudos como Sheridan (1979) estreitar o alvo tenha pesado mais que a distância.

### Exemplo 2: tamanhos reais de alvos, e onde o toque quebra o modelo

A WCAG 2.2 fixa 24 por 24 pixels CSS como mínimo do Nível AA (Critério de Sucesso 2.5.8, que tem exceções como espaçamento suficiente) e 44 por 44 para o Nível AAA (2.5.5). A uma distância de 400 pixels CSS, escolhida para este exemplo:

```text
W = 24:  ID = log2(400/24 + 1) = 4,14 bits
W = 44:  ID = log2(400/44 + 1) = 3,33 bits     diferença 0,81 bits
```

O ID não depende de dispositivo, mas um tempo precisa de uma inclinação. Tome $b=200$ ms/bit, valor **suposto** perto do inverso de um throughput típico de mouse (MacKenzie dá cerca de 4 a 5 bits/s). O alvo maior economiza então cerca de 160 ms por seleção, e $a$ se cancela na diferença.

Com dedos, a própria fórmula enfraquece. Bi, Li e Zhai (2013) rodaram uma tarefa 1D num celular com 12 participantes, usando o indicador. Cada condição $A\times W$ teve 16 tentativas.

```text
A  W     erro     ID nominal  ID efetivo    ID FFitts  tempo (ms)
20 2,4    29%       3,22        2,32         2,89        432
30 2,4    38%       3,75        2,69         3,13        483
20 4,8    14%       2,37        2,07         2,34        383
30 4,8    11%       2,86        2,53         2,82        433
20 7,2     3%       1,92        1,97         2,18        367
30 7,2     6%       2,37        2,34         2,53        394
```

Tamanhos em mm. Regredindo o tempo em cada índice:

```text
ID nominal    T = 243,8 +  62,4 ID    R2 = 0,956
ID efetivo    T =  77,7 + 145,5 ID    R2 = 0,862
ID FFitts     T = 109,8 + 115,4 ID    R2 = 0,958
```

A terceira linha bate com o ajuste publicado. O argumento deles é que o dedo tem uma imprecisão absoluta que a velocidade não muda. O FFitts retira esse componente, $\sigma_a$, da dispersão dos pontos finais. A largura efetiva supõe que toda dispersão é escolha de velocidade, então vai mal aqui. Em 2,4 mm, a largura efetiva foi mais que o dobro da nominal. Note que o ajuste nominal parece ótimo com $R^2=0{,}956$ enquanto esconde taxas de erro de até 38%. Uma previsão de tempo nada diz sobre esses erros.

**Suponha** 160 pixels CSS por polegada: 24 px viram 3,8 mm, entre as linhas de 2,4 e 4,8 mm, e 44 px viram 7,0 mm, perto da de 7,2 mm. É uma comparação grosseira, não um teste da WCAG. O estudo mediu alvos isolados, e o 2.5.8 também trata do espaçamento aos vizinhos.

### Exemplo 3: o tamanho de um efeito de Hick

Ir de 4 para 32 opções acrescenta 3 bits com $\log_2 n$, ou 2,72 com $\log_2(n+1)$. Multiplique os 3 bits por inclinações relatadas:

```text
Hick, lâmpadas e chaves    ~200 ms/bit    600 ms
Knight e Dagnall, início     73 ms/bit    219 ms
Knight e Dagnall, fim        23 ms/bit     69 ms
Seleção de comando, mouse     4 ms/bit     12 ms
```

Essas inclinações vêm de tarefas diferentes: é noção de escala, não comparação única. Probabilidades desiguais também reduzem o custo. Para 8 itens com frequências proporcionais a $1/i$ (forma de Zipf, suposta aqui), $H=2{,}62$ bits contra 3,00 com frequências iguais.

### Exemplo 4: 32 itens, três layouts

Seguindo Liu e colegas, compare uma página, 4 páginas aleatórias de 8 e 4 categorias de 8, com $a=0{,}2$ s e $b=0{,}15$ s/bit **supostos**. Acrescente uma varredura linear a 0,25 s por item, **suposto**, parando no alvo e ignorando a troca de página.

```text
Layout              Forma de Hick                  Hick    Varredura
Uma página de 32    a + 5b                         0,95 s  16,5 itens  4,13 s
4 páginas aleatórias 2,5(a + 3b)                   1,63 s  16,5 itens  4,13 s
4 categorias de 8   2a + 5b                        1,15 s   7,0 itens  1,75 s
```

A coluna de Hick favorece uma página plana. A da varredura favorece categorias, supondo que a pessoa saiba a categoria. Logo, "dividir o menu" decorre da busca, não de Hick.

Agora acrescente o apontar. Tome um menu vertical com itens de altura $h$ e ponteiro logo acima do primeiro item, então $A=i\,h$, $W=h$, $ID=\log_2(i+1)$, com alvos equiprováveis. Use o $b=200$ ms/bit **suposto**, a taxa de varredura suposta de 0,25 s por item e nenhum intercepto:

```text
n     ID médio    especialista: apontar    novato: varredura + apontar
8     2,31         462 ms                  1587 ms
16    3,02         604 ms                  2729 ms
32    3,83         767 ms                  4892 ms
```

É uma construção didática, não uma medição. Para o especialista, que já sabe a posição, dobrar a lista acrescenta cerca de 150 ms; para o novato, a busca domina.

## Equívocos Comuns e Armadilhas

- **"A lei de Hick diz que menus devem ser curtos."** Ela trata de reação de escolha e, ao pé da letra, favorece uma lista longa.
- **"A lei de Fitts dá o tempo deste botão."** Só com $a$ e $b$ medidos para aquele dispositivo, tarefa e população.

## Resumo

A lei de Fitts prevê o tempo de movimento dirigido com $MT=a+b\,ID$, aqui na forma de Shannon de MacKenzie, $\log_2(A/W+1)$. Coeficientes pertencem a um dispositivo e a uma tarefa, e a largura efetiva corrige os erros. Para alvos de toque pequenos, o FFitts modela a imprecisão absoluta do dedo. A lei de Hick liga o tempo de reação de escolha à entropia em tarefas simples e treinadas, de 1 a 4 bits, e compatibilidade e prática a achatam. Ela não sustenta menus curtos: esse argumento se apoia na busca visual, que nenhum dos dois modelos cobre.

## Documentation Links

- [MacKenzie (2018): Fitts' Law](https://www.yorku.ca/mack/hhci2018.html): dados do estilete de 1 oz, formulações, largura efetiva, throughput e um estudo de toque.
- [MacKenzie (1992): Fitts' Law as a Research and Design Tool in HCI](https://www.yorku.ca/mack/hci1992.html): formulações, reanálise, problemas conhecidos e a comparação entre estudos.
- [Liu et al. (2020): How Relevant is Hick's Law for HCI?](https://hal.science/hal-02867301/document): versão dos autores, com experimentos, limites e o argumento sobre design.
- [Bi, Li, and Zhai (2013): FFitts Law](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41645.pdf): a hipótese da dupla distribuição e os dados do Exemplo 2.
- [Budiu (2022): Fitts's Law and Its Applications in UX](https://www.nngroup.com/articles/fitts-law/): implicações práticas, incluindo bordas de tela.
- [W3C: Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): o critério de Nível AA e suas exceções.
- [W3C: Understanding SC 2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html): o critério de Nível AAA.
