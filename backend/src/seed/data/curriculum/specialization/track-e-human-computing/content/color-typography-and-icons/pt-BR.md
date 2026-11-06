---
version: 1.0
updatedAt: 2026-11-04
title: "Cor, Tipografia e Ícones"
summary: "Contraste de cor e visão de cores, hierarquia tipográfica e legibilidade, e quando um ícone precisa de rótulo."
---
## Objetivos de Aprendizagem

- Calcular a luminância relativa e a razão de contraste da WCAG, e aplicar 4,5:1 e 3:1 sem arredondar.
- Explicar por que a luminância da WCAG, um valor de cinza BT.601 e o Value do HSV discordam sobre a mesma cor.
- Citar a prevalência de deficiência de visão de cores com sua população, e projetar cores de status que não dependam só do matiz.
- Separar legibilidade de leiturabilidade, e dizer o que os estudos sobre serifa mediram e o que deixaram em aberto.
- Decidir quando um ícone precisa de rótulo visível, com evidência sobre reconhecimento em vez de slogans.

## Contexto e Motivação

`forms-and-input-design` trata de rótulos e mensagens de erro, que falham se o texto não pode ser visto ou se o erro é sinalizado por um matiz que a pessoa não separa. `grayscale-color-and-color-spaces` deu a representação: três canais, um valor de cinza BT.601 para processamento de imagens e o HSV para separar matiz de brilho. Nenhum desses números é o que uma verificação de contraste usa.

O escopo é tela sRGB e, principalmente, texto em alfabeto latino. Cada recomendação abaixo diz em quem foi medida, ou avisa que é convenção.

## Teoria Central

### Luminância relativa e razão de contraste

A WCAG 2.2 define as duas grandezas para sRGB. Para um canal de 8 bits $C_8$, seja $c=C_8/255$, e decodifique para luz linear:

$$C=\begin{cases}c/12{,}92 & c\le 0{,}04045\\ \left(\dfrac{c+0{,}055}{1{,}055}\right)^{2{,}4} & \text{caso contrário.}\end{cases}$$

A luminância relativa e a razão de contraste são então

$$L=0{,}2126R+0{,}7152G+0{,}0722B,\qquad \text{contraste}=\frac{L_1+0{,}05}{L_2+0{,}05},$$

com $L_1$ a cor mais clara. A razão vai de 1 a 21.

**A discrepância do limiar.** Cópias antigas dessa fórmula, e muitas calculadoras, usam 0,03928 em vez de 0,04045. A WCAG 2.2 registra a mudança: o valor antigo estava na definição antes de maio de 2021, e "has no practical effect on the calculations in the context of these guidelines." Para cor de 8 bits o efeito é exatamente zero: o nível 10 dá $c=0{,}03922$, abaixo dos dois limiares, e o nível 11 dá $c=0{,}04314$, acima dos dois. Um laço pelos 256 níveis não acha nenhum em que as duas versões difiram. Só em profundidades maiores um nível pode cair no meio.

### Os limites

| Critério (WCAG 2.2) | Nível | Exigência |
|---|---|---|
| 1.4.1 Use of Color | A | Cor não é o único meio visual de transmitir informação |
| 1.4.3 Contrast (Minimum) | AA | Texto 4,5:1, texto em grande escala 3:1 |
| 1.4.6 Contrast (Enhanced) | AAA | Texto 7:1, texto em grande escala 4,5:1 |
| 1.4.11 Non-text Contrast | AA | 3:1 para partes de controles e gráficos necessárias para identificá-los ou entendê-los |

Grande escala significa pelo menos 18 pontos, ou 14 pontos em negrito. Com 1pt = 1,333 px de CSS, isso dá 24px e $14\times4/3=18{,}67$px, que a página Understanding do W3C escreve como aproximadamente 18,5px. Controles inativos, pura decoração e logotipos ficam fora do 1.4.3.

O W3C trata as razões como limites e diz que valores calculados não devem ser arredondados: 4,499:1 não atinge 4,5:1. O 3:1 vem de recomendações antigas da ISO e da ANSI para visão padrão, e o 4,5:1 o multiplica por uma perda de sensibilidade ao contraste de cerca de 1,5, associada à acuidade 20/40. Os números modelam um tipo de perda de visão como linha de aprovação. Fora a separação entre texto normal e grande escala, eles ignoram a espessura do traço, e a WCAG observa que fontes muito finas são mais difíceis de ler com pouco contraste.

### Deficiência de visão de cores: números com população

O MedlinePlus Genetics (National Library of Medicine dos EUA) dá estes números: a deficiência de visão de cores afeta cerca de 2,5 por cento das pessoas no mundo. A deficiência vermelho-verde, a forma mais comum, ocorre em cerca de 1 a cada 12 homens e 1 a cada 200 mulheres **entre populações com ascendência do norte da Europa**. Ela também é comum em populações do leste asiático e menos comum em quase todas as outras populações estudadas. A deficiência azul-amarelo afeta menos de 1 a cada 10.000 pessoas no mundo.

Logo, "8 por cento dos usuários são daltônicos" engana duas vezes: 1 a cada 12 fala de homens, e de um grupo de ascendência. Um público dessa ascendência, metade homens e metade mulheres, dá $\tfrac12(\tfrac1{12}+\tfrac1{200})=4{,}4$ por cento.

A consequência de projeto é o 1.4.1, que fala de redundância e não de proibir matizes. Vermelho e verde convivem se outra coisa os separa: luminância, forma, uma palavra (Exemplo 3).

### Legibilidade, leiturabilidade e a questão da serifa

Aqui, **legibilidade** é a facilidade de distinguir letras e palavras, e **leiturabilidade** é a facilidade de ler texto corrido. A segunda acrescenta espaçamento, comprimento de linha, idioma e o próprio leitor.

"Serifa é melhor no papel, sem serifa na tela" costuma ser dito como lei. Um teste limpo disponível em artigo aberto é Perea (2013). O resultado principal é que não houve diferença confiável: o tempo total de leitura da frase foi de 2370 ms com serifa e 2392 ms sem serifa ($p=0{,}32$), e as durações de fixação e as medidas na palavra-alvo não mostraram efeito de fonte. A única medida significativa foi o número de sacadas progressivas, 10,74 contra 10,58 ($p=0{,}024$), e ela sumiu quando todas as sacadas foram contadas ($p>0{,}13$). O desenho: 24 universitários falantes nativos de espanhol, com visão normal ou corrigida, leram 120 frases de uma linha numa tela, em Lucida ou Lucida Sans de 14 pontos, com rastreador ocular. Usar uma só família evita comparar Times com Helvetica, fontes que diferem em muito mais do que serifa.

Perea também relata dois resultados anteriores. Arditi e Cho (2005) criaram três tipos que diferiam no tamanho da serifa, não acharam efeito significativo em seus três participantes, um de visão normal e dois com baixa visão, e concluíram que os efeitos são "unlikely to be of significance at typical print sizes viewed under normal conditions". Moret-Tatay e Perea (2011) não acharam vantagem da serifa na identificação de palavras, com a fonte sem serifa até mais rápida, por uma mediana de 6 ms.

Nada disso compara papel com tela, nem testa leitura longa. A afirmação honesta é mais estreita que os slogans: nessas comparações dentro da mesma família, nessas condições, a serifa não fez diferença prática. Escolha pelo tom e por como a fonte se renderiza no tamanho usado, e teste com seus leitores se valer a pena.

### Hierarquia e espaçamento

Hierarquia vem de tamanho, peso, espaçamento e posição. Uma escala modular é convenção, não achado: razão 1,25 a partir de 16px dá 16, 20, 25, 31,25 e 39,06. Sua interação real com acessibilidade é a fronteira do texto grande, porque cruzá-la muda a razão exigida (Exemplo 4).

Dois critérios são mal lidos. O **1.4.12 Text Spacing (AA)** cita altura de linha 1,5, espaço entre parágrafos 2, espaço entre letras 0,12 e entre palavras 0,16, tudo vezes o tamanho da fonte. O conteúdo "is not required to use these text spacing values". A exigência é que nada se perca quando o usuário sobrescreve o espaçamento com esses valores. O **1.4.8 Visual Presentation (AAA)** lista largura de no máximo 80 caracteres (40 em CJK), e de novo pede um mecanismo, que pode vir do navegador. Nenhum dos dois é regra de composição.

### Ícones: reconhecimento se aprende

O artigo de 2014 do Nielsen Norman Group defende que poucos ícones (casa, impressora, lupa de busca) têm reconhecimento quase universal, que a maioria dos outros continua ambígua entre interfaces e que um rótulo visível deve acompanhá-los. Isso é orientação de trabalho de usabilidade, não experimento controlado.

Dois relatos posteriores do NN/g medem coisas diferentes.

- **Navegação escondida, 2016.** Com 179 participantes em 6 sites reais, esconder a navegação principal reduziu a descoberta de conteúdo e aumentou o tempo de tarefa e a dificuldade relatada. Menus escondidos foram usados em 27 por cento dos casos no desktop, contra 48 por cento com navegação visível e 50 por cento com a combinada. No celular os números foram 57 por cento para a escondida e 86 por cento para a combinada (a visível não foi testada no celular). Isso é sobre esconder navegação, e não mostra falha em reconhecer o ícone.
- **Reconhecimento, 2025.** Participantes que viram ícones de hambúrguer em contexto em geral os identificaram como o menu principal, sobretudo na posição esperada, no canto superior esquerdo, e com estilo padrão (três linhas empilhadas). Em um exemplo, o ícone do Dick's Sporting Goods ainda foi lido como menu com o rótulo Menu removido da captura de tela. O artigo não dá porcentagens e diz que cobriu só reconhecimento, sem medir tempo ou sucesso de tarefa. Ícones de lista e de filtro feitos de linhas também foram lidos como navegação.

Juntando os dois: reconhecimento nasce da exposição e depende de posição, e ser reconhecido não torna um controle escondido tão descobrível quanto um visível. A regra "sempre rotule" tem, portanto, exceções: ícone padrão, no lugar convencional, para quem conhece a plataforma, com o custo de espaço justificado. Um ícone novo, ou um coração ou estrela cujo sentido muda de site para site, precisa de uma palavra. Teste perguntando o que as pessoas esperam do ícone, e de novo depois, para checar memória.

Um controle só de ícone ainda precisa de nome acessível (1.1.1, 4.1.2), de 3:1 contra o fundo se é o desenho que o identifica (1.4.11) e de um alvo de pelo menos 24 por 24 pixels de CSS, com as exceções do 2.5.8 (AA).

## Exemplos Resolvidos

### Exemplo 1: um nível de cinza decide a aprovação

Verifique `#767676` e `#777777` como texto sobre branco. Os dois são cinzas, então $L$ é o próprio canal decodificado.

```text
hex      C8    c         L         contraste com branco
#767676  118   0,462745  0,181164  1,05/0,231164 = 4,5422
#777777  119   0,466667  0,184475  1,05/0,234475 = 4,4781
```

`#767676` passa no 1.4.3 e `#777777` reprova, embora ambos arredondassem para 4,5. O cinza mais claro que passa sobre branco é `#949494` em 3:1, `#767676` em 4,5:1 e `#595959` em 7:1. Vermelho puro `#FF0000` sobre branco dá 3,9985, que reprova para corpo de texto e passa para texto grande.

### Exemplo 2: três números de "brilho" para uma cor

As duas primeiras linhas são os pixels usados em `grayscale-color-and-color-spaces`. As duas últimas são amarelo puro e azul puro.

```text
RGB             cinza BT.601  HSV V   L WCAG   contraste com branco
(200, 50, 50)    94,85        0,784   0,1479   5,31
(50, 200, 50)   138,05        0,784   0,4222   2,22
(255, 255, 0)   225,93        1,000   0,9278   1,07
(0, 0, 255)      29,07        1,000   0,0722   8,59
```

O Value do HSV diz que as duas primeiras são iguais e que as duas últimas são iguais, mas texto branco passa numa de cada par e reprova na outra. Value é o maior canal, então não diz nada sobre luminância. O BT.601 acerta a ordem aqui, mas pondera valores com gama: 94,85 é 0,372 da escala, contra $L=0{,}1479$. Só a luminância decodificada entra na fórmula de contraste.

### Exemplo 3: um par de status que depende do matiz

Tome dois selos, vermelho `#D32F2F` para falhou e verde `#388E3C` para passou. Texto branco passa no vermelho (4,98) e fica abaixo no verde (4,12, reprovação no 1.4.3 em tamanhos pequenos). Um contra o outro, o contraste é só **1,21**, então a luminância quase não os separa, e o par depende do matiz.

Um modelo da perda é a matriz de Machado, Oliveira e Fernandes (2009) da coluna de deuteranomalia na severidade 1,0, que o artigo diz corresponder à dicromacia. Aplicada a sRGB linearizado, ela leva o par a (139, 124, 40) e (134, 122, 66), com contraste 1,03. É simulação, não experiência relatada, mas concorda com a luminância. Há duas correções.

- Acrescentar uma pista que não seja cor: uma palavra ("Falhou") ou um ícone distinto. Isso atende ao 1.4.1.
- Separar a luminância: vermelho escuro `#B71C1C` com verde claro `#A5D6A7` dá cerca de 4,0, e 3,29 na simulação.

A segunda correção também mostra que "nunca use vermelho e verde juntos" é forte demais. O defeito do primeiro par é luminância igual sem pista redundante.

### Exemplo 4: onde cai a fronteira do texto grande

O cinza de título `#949494` sobre branco dá 3,03:1, e o cinza de corpo `#767676` dá 4,54:1. Aplique a fronteira à escala de razão 1,25.

```text
papel           tamanho  peso   grande escala?  exigido   #949494 (3,03)
corpo           16px     400    não             4,5:1     reprova
destaque        20px     400    não             4,5:1     reprova
destaque bold   20px     700    sim             3:1       passa
título          25px     400    sim             3:1       passa
```

A mesma cor reprova em 20px e passa em 25px, e o negrito leva 20px para o outro lado porque passa de 18,67px. Um token `muted` não pode ser julgado isolado: o resultado depende do tamanho e do peso.

## Equívocos Comuns e Armadilhas

- **"Passar no contraste significa que o texto é legível."** Significa que uma razão de luminância superou uma linha. Traço fino, tamanho pequeno e fundo poluído não estão na fórmula.
- **"A fórmula com 0,03928 dá resultado errado."** Para cores de 8 bits ela dá resultado idêntico. Use 0,04045 porque essa é a definição atual.
- **"8 por cento dos usuários são daltônicos."** O número precisa vir com sexo e ascendência.
- **"Um simulador de vermelho-verde prova que o design funciona."** Simulação é modelo de uma deficiência numa severidade. Não substitui a pista redundante nem o teste com pessoas que têm deficiência de visão de cores.
- **"Os estudos do hambúrguer provam que o ícone não é entendido."** O de 2016 mediu navegação escondida, e o de 2025 achou o ícone reconhecido na maior parte dos casos.

## Resumo

Contraste vem da luminância relativa, calculada depois de decodificar o sRGB, e não é valor de cinza nem Value do HSV. O limiar antigo não muda nada em cores de 8 bits. A WCAG 2.2 pede, no nível AA, 4,5:1 para texto e 3:1 para texto em grande escala e para partes não textuais com significado, sem arredondar, e esses números são um modelo de perda moderada de visão. Prevalência precisa de população. O critério 1.4.1 proíbe a cor como único meio visual de significado, o que é regra de redundância e não veto a um matiz. Estudos de serifa na mesma família não acharam diferença prática, e não testaram papel contra tela. Reconhecimento de ícone é aprendido e depende de posição, então só se dispensa o rótulo num ícone convencional, em lugar convencional, e o controle mantém um nome acessível.

## Documentation Links

- [W3C (2024): Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/): as definições de luminância relativa e razão de contraste, a nota sobre 0,03928 e os critérios 1.4.1, 1.4.3, 1.4.6, 1.4.8, 1.4.11, 1.4.12 e 2.5.8.
- [W3C: Understanding Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): conversão de pontos para pixels, a regra de não arredondar e a justificativa das razões.
- [MedlinePlus Genetics: Color vision deficiency](https://medlineplus.gov/genetics/condition/color-vision-deficiency/): prevalência por tipo e população.
- [Perea (2013): Why does the APA recommend the use of serif fonts?](https://www.psicothema.com/pdf/4073.pdf): o experimento de movimentos oculares com Lucida e Lucida Sans, e sua revisão de estudos anteriores sobre serifa.
- [Machado, Oliveira, and Fernandes (2009): A Physiologically-based Model for Simulation of Color Vision Deficiency](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html): as matrizes de simulação por severidade.
- [Nielsen Norman Group (2014): Icon Usability](https://www.nngroup.com/articles/icon-usability/): quais ícones são amplamente reconhecidos, e a defesa do rótulo visível.
- [Nielsen Norman Group (2016): Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/): o estudo quantitativo de navegação escondida, visível e combinada.
- [Nielsen Norman Group (2025): The Hamburger-Menu Icon Today: Is it Recognizable?](https://www.nngroup.com/articles/hamburger-menu-icon-recognizability/): o reconhecimento hoje, o papel da posição e os limites desse estudo.
