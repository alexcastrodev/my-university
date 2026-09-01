---
version: 1.0
updatedAt: 2026-08-14
title: "Huffman Coding"
description: "O algoritmo guloso que constrói um código binário livre de prefixo ótimo mesclando repetidamente os dois símbolos menos frequentes numa trie, provado ótimo via um argumento de troca e subestrutura ótima."
---
## Objetivo

Entenda Huffman coding — o algoritmo guloso que constrói um código binário *livre de prefixo* ótimo para um conjunto de caracteres a partir de suas frequências, mesclando de baixo para cima os dois símbolos menos frequentes com uma fila de prioridade mínima até restar uma única trie — e por que esse processo guloso de construção de trie é provadamente ótimo, não apenas uma boa heurística.

## Casos de Uso

- Compactar um arquivo de dados dando aos caracteres frequentes codewords binárias curtas e aos caracteres infrequentes codewords longas, em vez de gastar o mesmo número fixo de bits em todo caractere.
- Compressão sem perdas de propósito geral para *qualquer* fluxo de bytes (texto, dados genômicos, bitmaps) — Sedgewick e Wayne observam que é eficaz muito além de arquivos em linguagem natural porque depende apenas da distribuição de frequência dos valores de byte da entrada, não do que esses bytes significam.
- Como um exemplo resolvido claro (junto com activity-selection) de provar um algoritmo guloso correto via a propriedade da escolha gulosa e subestrutura ótima, em vez de confiar na intuição de "parece certo" — o algoritmo de Huffman precisa tanto de uma prova por argumento de troca (Lema 15.2) quanto de um argumento de subestrutura ótima (Lema 15.3) antes de poder ser confiado.

## Aprofundamento

### Códigos livres de prefixo: por que "nenhuma codeword é prefixo de outra" importa

O exemplo corrente de Cormen, Leiserson, Rivest e Stein: um arquivo de 100.000 caracteres sobre um alfabeto de 6 caracteres `a–f`, com frequências (em milhares) `a:45 b:13 c:12 d:16 e:9 f:5`. Um código de comprimento fixo precisa de `⌈lg 6⌉ = 3` bits por caractere (`a=000, b=001, c=010, d=011, e=100, f=101`), custando `300.000` bits no total. Um código de comprimento variável que dá codewords curtas a caracteres frequentes e codewords longas a caracteres raros — `a=0, b=101, c=100, d=111, e=1101, f=1100` — custa apenas

```
(45·1 + 13·3 + 12·3 + 16·3 + 9·4 + 5·4) · 1.000 = 224.000 bits
```

uma economia de cerca de 25%, e (segundo Cormen) esse é de fato o código de caracteres ótimo para esse arquivo.

Um código com essa propriedade — nenhuma codeword é prefixo de nenhuma outra codeword — é chamado **livre de prefixo**. Sedgewick e Wayne motivam a mesma ideia pelo lado da decodificação: codifique `A B R A C A D A B R A !` atribuindo `A=0, B=1, R=00, C=01, D=10, !=11`. Descartando os espaços delimitadores, `0` (o código de A) é prefixo de `00` (o código de R), então a bitstring `01000010100100011` pode ser decodificada como `C R R D D C R C B` ou várias outras strings — é genuinamente ambígua. Troque para uma atribuição livre de prefixo — `A=0, B=11111, C=110, D=100, R=1110, !=101` — e a string de 30 bits `011111110011001000111111100101` decodifica de apenas um jeito: `A B R A C A D A B R A !`. Nenhum delimitador é jamais necessário, porque a codeword que começa um arquivo codificado é sempre inequívoca: identifique-a, traduza-a, e repita no restante. O próprio exemplo de decodificação do Cormen funciona da mesma forma — a string `100011001101` se decompõe de forma única como `100 · 0 · 1100 · 1101`, decodificando para `cafe`.

Uma árvore binária cujas folhas são os caracteres representa um código livre de prefixo diretamente: interprete a codeword de um caractere como o caminho raiz-até-folha, `0` para "vá à esquerda" e `1` para "vá à direita". A árvore de um código ótimo é sempre uma árvore binária *cheia* (todo não-folha tem exatamente dois filhos) — uma árvore com `|C|` folhas tem exatamente `|C| - 1` nós internos. Para uma árvore `T`, o número de bits necessários para codificar o arquivo é seu custo

```
B(T) = Σ (c.freq · dT(c))   sobre todos os caracteres c
```

onde `dT(c)` é a profundidade da folha de `c` — também o comprimento da codeword de `c`.

### A trie em código: construindo, codificando, decodificando com ela (Sedgewick)

Sedgewick e Wayne representam o código como uma trie, usando este tipo de nó (`freq` conduz a construção; `ch` só tem significado nas folhas):

```java
private static class Node implements Comparable<Node>
{ // nó de trie de Huffman
   private char ch;   // não usado nos nós internos
   private int freq; // não usado para expand
   private final Node left, right;

    Node(char ch, int freq, Node left, Node right)
    {
       this.ch    = ch;
       this.freq = freq;
       this.left = left;
       this.right = right;
    }
    public boolean isLeaf()
    { return left == null && right == null; }
    public int compareTo(Node that)
    { return this.freq - that.freq; }
}
```

Construir a tabela de códigos a partir de uma trie pronta é uma simples caminhada recursiva, anexando `'0'` indo à esquerda e `'1'` indo à direita até chegar numa folha:

```java
private static void buildCode(String[] st, Node x, String s)
{ // Cria uma tabela de lookup a partir da trie (recursiva).
   if (x.isLeaf())
   { st[x.ch] = s; return; }
   buildCode(st, x.left, s + '0');
   buildCode(st, x.right, s + '1');
}
```

A expansão (decodificação) é simétrica e não precisa de nenhuma tabela de lookup — apenas caminhe pela trie bit a bit a partir da raiz, movendo à direita num bit `1` e à esquerda num bit `0`, e emita o caractere sempre que uma folha for alcançada, depois reinicie na raiz:

```java
Node x = root;
while (!x.isLeaf())
    if (BinaryStdIn.readBoolean()) x = x.right;
    else x = x.left;
BinaryStdOut.write(x.ch);
```

Sedgewick e Wayne chamam essa simplicidade de expansão de "uma razão para a popularidade dos códigos livres de prefixo em geral e da compressão de Huffman em particular".

### O algoritmo guloso de Huffman: mesclando os dois nós menos frequentes com uma fila de prioridade mínima

O algoritmo de Huffman constrói a trie de baixo para cima: comece com `|C|` folhas (uma por caractere), e repetidamente extraia os dois nós de frequência mais baixa de uma fila de prioridade mínima, mescle-os sob um novo nó interno cuja frequência é a soma deles, e reinsira esse nó — até que reste um nó (a raiz). O pseudocódigo do Cormen:

```
HUFFMAN(C)
 1  n = |C|
 2  Q = C
 3  para i = 1 até n - 1
 4      aloque um novo nó z
 5      x = EXTRACT-MIN(Q)
 6      y = EXTRACT-MIN(Q)
 7      z.left = x
 8      z.right = y
 9      z.freq = x.freq + y.freq
10      INSERT(Q, z)
11  retorne EXTRACT-MIN(Q)   // a raiz da árvore é o único nó restante
```

O `buildTrie()` de Sedgewick e Wayne é o mesmo algoritmo usando uma `MinPQ<Node>` (ordenada por `compareTo`, isto é, por `freq`):

```java
private static Node buildTrie(int[] freq)
{
    // Inicializa a fila de prioridade com árvores unitárias.
    MinPQ<Node> pq = new MinPQ<Node>();
    for (char c = 0; c < R; c++)
       if (freq[c] > 0)
          pq.insert(new Node(c, freq[c], null, null));

    while (pq.size() > 1)
    { // Mescla as duas árvores menores.
       Node x = pq.delMin();
       Node y = pq.delMin();
       Node parent = new Node('\0', x.freq + y.freq, x, y);
       pq.insert(parent);
    }
    return pq.delMin();
}
```

Com `Q` implementada como um min-heap binário (veja o conceito de binary-heaps-and-heapsort), `BUILD-MIN-HEAP` inicializa `Q` em `O(n)`, e cada uma das `n - 1` iterações do laço faz operações de heap `O(1)` a `O(lg n)` cada, então `HUFFMAN` roda em `O(n lg n)` total sobre `n` caracteres.

Percorrendo o exemplo `a:45 b:13 c:12 d:16 e:9 f:5` do Cormen, as cinco mesclagens (cada passo combinando os dois nós de frequência mais baixa atualmente na fila) são: `f:5 + e:9 = 14`, depois `c:12 + b:13 = 25`, depois `14 + d:16 = 30`, depois `25 + 30 = 55`, depois `a:45 + 55 = 100`. A árvore resultante é exatamente a árvore ótima da Figura 15.5(b), dando as codewords `a=0, b=101, c=100, d=111, e=1101, f=1100`:

```viz
type: tree
insert root 100 | Raiz — frequência total 100 (todos os 100.000 caracteres, em milhares). Formada pela mesclagem final.
insert a a:45 parent=root side=left | Mesclado por último (a:45 + 55 = 100) -- codeword mais curta, "0".
insert r55 55 parent=root side=right | Mescla o nó-25 e o nó-30 (55 = 25 + 30).
insert r25 25 parent=r55 side=left | Mescla c e b (25 = c:12 + b:13).
insert r30 30 parent=r55 side=right | Mescla o nó-14 e d (30 = 14 + d:16).
insert c c:12 parent=r25 side=left | Codeword "100".
insert b b:13 parent=r25 side=right | Codeword "101".
insert r14 14 parent=r30 side=left | A primeiríssima mesclagem -- f e e são as duas folhas de frequência mais baixa (14 = f:5 + e:9).
insert d d:16 parent=r30 side=right | Codeword "111".
insert f f:5 parent=r14 side=left | Codeword "1100" -- codeword mais longa, empatada com e.
insert e e:9 parent=r14 side=right | Codeword "1101".
```

### Provando otimalidade: propriedade da escolha gulosa, subestrutura ótima e uma prova indutiva

O Cormen divide a prova de corretude em dois lemas. **Lema 15.2 (propriedade da escolha gulosa)**: se `x` e `y` são os dois caracteres de frequência mais baixa em `C`, existe um código ótimo livre de prefixo no qual `x` e `y` são folhas irmãs da mesma profundidade máxima. A prova é um argumento de troca: pegue qualquer árvore ótima `T`, sejam `a` e `b` suas duas folhas irmãs de profundidade máxima, e troque `x` para a posição de `a` e `y` para a posição de `b`. Cada troca não pode aumentar o custo — `(a.freq - x.freq)(dT(a) - dT(x)) ≥ 0` porque `x` tem frequência mínima e `a` tem profundidade máxima — então a árvore resultante `T''` continua ótima, e agora tem `x` e `y` como folhas irmãs.

**Lema 15.3 (subestrutura ótima)**: seja `C'` igual a `C` com `x` e `y` substituídos por um único caractere mesclado `z` (`z.freq = x.freq + y.freq`), e seja `T'` uma árvore ótima para `C'`. Então a árvore `T` obtida expandindo `z` de volta num nó interno com filhos `x` e `y` é ótima para `C`. Isso decorre porque `B(T) = B(T') + x.freq + y.freq` — mesclar/desmesclar um par de folhas irmãs muda o custo total por exatamente o valor fixo `x.freq + y.freq`, então um `T'` ótimo não pode deixar de produzir um `T` ótimo. O **Teorema 15.4**, de que `HUFFMAN` produz um código livre de prefixo ótimo, decorre imediatamente dos dois lemas.

Sedgewick e Wayne dão o mesmo resultado como uma indução (**Proposição U**), sobre o número de símbolos `r`: assumindo que o algoritmo de Huffman é ótimo para menos de `r` símbolos, sejam `(si, fi)` e `(sj, fj)` os primeiros dois símbolos mesclados em `(s*, fi + fj)` na profundidade `d`. Como mesclar muda o comprimento de caminho ponderado por exatamente `fi + fj` independentemente de em qual árvore ótima isso é feito (`W(TH) = W(TH*) + (fi + fj)` e `W(T) = W(T*) + (fi + fj)`), e `TH*` é ótima pela hipótese indutiva, segue que `W(TH) ≤ W(T)` para qualquer árvore `T` — então `TH` é ótima. Isso se apoia na **Proposição T**: para qualquer código livre de prefixo, o comprimento da bitstring codificada é igual ao *comprimento de caminho externo ponderado* da árvore — frequência vezes profundidade, somado sobre todas as folhas. Sedgewick e Wayne verificam isso diretamente no exemplo `it was the best of times it was the worst of times`: uma folha à distância 2 (`SP`, frequência 11), três à distância 3 (`e s t`, frequência total 19), três à distância 4 (`w o i`, frequência total 10), cinco à distância 5 (`r f h m a`, frequência total 9), duas à distância 6 (`LF b`, frequência total 2):

```
2·11 + 3·19 + 4·10 + 5·9 + 6·2 = 176 bits
```

exatamente o comprimento da bitstring codificada em Huffman para essa entrada.

### Taxas de compressão na prática

Como um arquivo comprimido não pode ser decodificado sem a trie, Sedgewick e Wayne escrevem a própria trie no fluxo de bits (uma travessia em pré-ordem: `0` para um nó interno, `1` seguido do caractere de 8 bits para uma folha), que o decodificador lê de volta com um `readTrie()` recursivo correspondente. Esse overhead importa mais em entradas pequenas:

- `ABRACADABRA!` (12 caracteres, 96 bits como ASCII de 8 bits): a saída comprimida em Huffman é **120 bits** — uma *taxa de compressão de 125%*, ou seja, maior que o original, porque 59 bits vão para codificar a trie e 32 bits para a contagem de caracteres.
- `it was the best of times it was the worst of times` (51 caracteres, 408 bits como ASCII de 8 bits): comprimido para **352 bits**, taxa 86%, mesmo depois de 137 bits de trie e 32 bits de contagem.
- Um arquivo de genoma de vírus (50.000 bits): a compressão de Huffman usa 12.576 bits, apenas 40 bits a mais que um código fixo de 2 bits sob medida (12.536 bits) — porque as quatro letras genômicas ocorrem com frequências quase iguais, a trie de Huffman acaba equilibrada e efetivamente redescobre o código de 2 bits por conta própria.
- Um bitmap (1.536 bits): Huffman usa 816 bits versus 1.144 bits para codificação run-length, 29% menos bits; num bitmap de resolução mais alta (6.144 bits) a lacuna diminui para 11% (2.032 vs. 2.296 bits).
- O texto inteiro de *Tale of Two Cities* (5.812.552 bits): comprime para 3.043.928 bits, uma taxa de 52%.

## Trade-offs

- **Livre de prefixo não acontece por acidente.** Atribuir as codewords mais curtas aos caracteres mais frequentes não é automaticamente livre de prefixo — a tentativa ingênua de Sedgewick e Wayne (`A=0, R=00, ...`) falha porque `0` é prefixo de `00`, tornando a bitstring codificada genuinamente ambígua sem delimitadores. Só uma construção explícita de trie, onde todo caractere fica numa folha, garante a propriedade.
- **Dois passes, não streaming.** Construir a trie exige conhecer a frequência de todo caractere de antemão, então a entrada precisa ser lida uma vez para tabular frequências e uma segunda vez para comprimir — Sedgewick e Wayne fazem questão de dizer isso explicitamente: "Huffman encoding is a two-pass algorithm."
- **O código também precisa ser pago.** Um arquivo comprimido em Huffman precisa carregar sua própria trie também, ou não pode ser decodificado. Para entradas pequenas esse overhead pode superar totalmente a economia — `ABRACADABRA!` comprime para 125% do seu tamanho original — enquanto para entradas grandes (*Tale of Two Cities*, 52%) o custo fixo da trie é amortizado. O número real de economia só é preciso uma vez que o custo de codificação da trie é contado junto com a bitstring comprimida.
- **Ótimo, mas não único.** O método de Huffman não especifica como quebrar empates entre nós de frequência igual, nem qual filho mesclado vai à esquerda versus à direita; o Cormen observa que trocar os filhos de um nó "produz um código diferente do mesmo custo". Implementações diferentes podem produzir códigos de Huffman diferentes para a mesma entrada, todos igualmente ótimos em contagem total de bits.
- **"Código livre de prefixo ótimo" é uma garantia mais estreita que "a melhor compressão possível".** No exemplo de dados genômicos, Huffman precisa de 40 bits a mais que um esquema fixo de 2 bits feito à mão, porque a garantia de Huffman só cobre códigos livres de prefixo construídos com seu próprio overhead de trie autodescritiva — um esquema fixo específico de domínio que não precisa transmitir nenhuma descrição de código ainda pode superá-lo.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 15.3 "Huffman codes", pp. 431-439](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Robert Sedgewick, Kevin Wayne — Algorithms, 4th Edition, Section 5.5 "Data Compression" (Huffman coding), pp. 826-839](https://algs4.cs.princeton.edu/55compression/) — doc
- [java.util.zip.Deflater — o compressor baseado em DEFLATE do Java, que usa Huffman coding como um de seus dois estágios internos de compressão (junto com a eliminação de strings duplicadas LZ77)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/zip/Deflater.html) — doc
