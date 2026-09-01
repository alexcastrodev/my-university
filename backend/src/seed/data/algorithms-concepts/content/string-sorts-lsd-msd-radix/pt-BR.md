---
version: 1.0
updatedAt: 2026-08-13
title: "Ordenação de Strings: LSD e MSD Radix Sort"
description: "Explica LSD e MSD radix sort, dois métodos de ordenação de strings indexados por caractere e construídos sobre contagem indexada por chave que alcançam tempo linear evitando comparações por completo, além do corte para insertion sort e do 3-way radix quicksort como alternativa para alfabetos grandes."
---
## Objetivo

Entenda LSD e MSD radix sort: dois métodos de ordenação de strings que examinam *caracteres* individuais em vez de comparar chaves inteiras, construídos sobre uma primitiva compartilhada (contagem indexada por chave), que alcançam ordenação em tempo linear para strings ao evitar completamente o limite inferior N log N baseado em comparação.

## Casos de Uso

- Ordenar grandes coleções de strings de comprimento fixo ou códigos numéricos — placas de veículo, endereços IP, números de conta de largura fixa, números de telefone — onde o tempo linear do LSD radix sort supera qualquer ordenação por comparação.
- Ordenar coleções enormes de strings de comprimento variável onde a maioria das chaves diverge já nos primeiros caracteres — o MSD radix sort pode terminar depois de examinar só um punhado de caracteres por chave em vez da string inteira.
- Entender o piso teórico da ordenação: por que uma ordenação que evita `compareTo()` por completo e indexa diretamente num array pelo valor do caractere consegue superar o limite N log N que se aplica a ordenações baseadas em comparação.

## Aprofundamento

### Contagem indexada por chave: a primitiva por baixo dos dois radix sorts

Os dois radix sorts são construídos sobre a mesma ideia simples: se as chaves são inteiros pequenos em `[0, R)`, dá para ordenar numa única passada linear contando quantos itens têm cada valor de chave, transformando essas contagens em posições iniciais, e depois distribuindo os itens diretamente para essas posições — sem nenhuma comparação.

Pegue seis itens com chaves de inteiro pequeno `[2, 3, 3, 0, 1, 2]`. O método se divide em quatro passos:

```java
int N = a.length;
String[] aux = new String[N];
int[] count = new int[R + 1];

// 1. Calcula as contagens de frequência (deslocadas em +1 -- veja o passo 2).
for (int i = 0; i < N; i++)
    count[a[i].key() + 1]++;
// count[] agora é: [0, 1, 1, 2, 2] -- um item com chave 0, um com chave 1, dois com chave 2, dois com chave 3.

// 2. Transforma contagens em índices: a soma cumulativa dá o índice inicial de cada chave.
for (int r = 0; r < R; r++)
    count[r + 1] += count[r];
// count[] agora é: [0, 1, 2, 4, 6] -- chave 0 começa em 0, chave 1 em 1, chave 2 em 2, chave 3 em 4.

// 3. Distribui os registros para suas posições iniciais, avançando cada uma conforme usada.
for (int i = 0; i < N; i++)
    aux[count[a[i].key()]++] = a[i];

// 4. Copia de volta.
for (int i = 0; i < N; i++)
    a[i] = aux[i];
```

O deslocamento de `+1` no passo 1 é o que faz a soma cumulativa do passo 2 cair no índice de *início* de cada chave em vez do índice de fim. Como o passo 3 percorre o array original da esquerda para a direita e sempre escreve no *próximo slot disponível* para aquela chave (e então avança o contador), itens com chaves iguais mantêm sua ordem relativa original — a contagem indexada por chave é estável. Essa estabilidade não é um bônus aqui; é o motivo inteiro pelo qual o próximo algoritmo funciona.

### LSD radix sort: strings de comprimento fixo, da direita para a esquerda

O LSD (least-significant-digit) radix sort ordena strings todas do mesmo comprimento `W` executando a contagem indexada por chave `W` vezes — uma vez por posição de caractere, indo do caractere *mais à direita* para o mais à esquerda:

```java
public class LSD {
    public static void sort(String[] a, int W) {
        // Ordena a[] pelos W caracteres iniciais.
        int N = a.length;
        int R = 256;
        String[] aux = new String[N];

        for (int d = W - 1; d >= 0; d--) {
            // Ordena por contagem indexada por chave no d-ésimo caractere.
            int[] count = new int[R + 1];

            for (int i = 0; i < N; i++)
                count[a[i].charAt(d) + 1]++;

            for (int r = 0; r < R; r++)
                count[r + 1] += count[r];

            for (int i = 0; i < N; i++)
                aux[count[a[i].charAt(d)]++] = a[i];

            for (int i = 0; i < N; i++)
                a[i] = aux[i];
        }
    }
}
```

Não é óbvio à primeira vista que ordenar da direita para a esquerda, um caractere de cada vez, produza uma ordem final correta — e de fato não funciona, a menos que a contagem indexada por chave de cada passada seja estável. O argumento de corretude (Proposição B de Sedgewick & Wayne) é uma indução sobre os caracteres finais já examinados: depois de ordenar pelos `i` caracteres finais, quaisquer duas chaves já estão na ordem correta porque seus `i`-ésimos caracteres a partir do final diferem (aquela passada as posicionou corretamente), ou seus `i`-ésimos caracteres a partir do final são iguais, caso em que a estabilidade as mantém na ordem estabelecida pela passada anterior sobre os `i - 1` caracteres restantes. Em outras palavras: seja o que for que os caracteres anteriores (mais significativos) decidam eventualmente, a estabilidade garante que a passada atual nunca perturbe uma ordenação que uma passada posterior ainda não teve a chance de corrigir.

### Veja acontecendo: LSD radix sort, passada por passada

Ordenando cinco strings de 3 dígitos — `329, 720, 133, 910, 352` — com LSD radix sort. Cada passada é uma distribuição de contagem-indexada-por-chave num único dígito, movendo cada token diretamente para seu novo slot (este é o passo de distribuição `aux[count[key]++] = a[i]`, não uma troca baseada em comparação):

```viz
type: moves
move 329 4 | Passada 1 (dígito mais à direita, d=2): contagem indexada por chave no dígito das unidades. "329" (dígito das unidades 9) vai para o último bucket, slot 4.
move 720 0 | "720" (dígito das unidades 0) vai para o primeiro bucket, slot 0.
move 133 3 | "133" (dígito das unidades 3) vai para o slot 3.
move 910 1 | "910" (dígito das unidades 0, mesmo bucket de "720") pousa logo depois dele no slot 1 -- a estabilidade preserva a ordem relativa original deles.
move 352 2 | "352" (dígito das unidades 2) vai para o slot 2. Depois da passada 1: 720, 910, 352, 133, 329.
move 720 1 | Passada 2 (dígito das dezenas, d=1): "720" (dígito das dezenas 2) vai para o slot 1.
move 910 0 | "910" (dígito das dezenas 1, o menor) vai para o slot 0.
move 352 4 | "352" (dígito das dezenas 5, o maior) vai para o slot 4.
move 133 3 | "133" (dígito das dezenas 3) vai para o slot 3.
move 329 2 | "329" (dígito das dezenas 2, mesmo bucket de "720") pousa logo depois dele no slot 2 -- estabilidade de novo. Depois da passada 2: 910, 720, 329, 133, 352.
move 910 4 | Passada 3 (dígito mais à esquerda, d=0): "910" (dígito das centenas 9) vai para o último slot, 4.
move 720 3 | "720" (dígito das centenas 7) vai para o slot 3.
move 329 1 | "329" (dígito das centenas 3) vai para o slot 1.
move 133 0 | "133" (dígito das centenas 1, o menor) vai para o slot 0.
move 352 2 | "352" (dígito das centenas 3, mesmo bucket de "329") pousa logo depois dele no slot 2 -- a estabilidade nas três passadas é o que torna esta ordem final correta: 133, 329, 352, 720, 910.
---
329
720
133
910
352
```

Três passadas, cada uma uma única varredura linear sem nenhuma comparação de caracteres — e o array termina totalmente ordenado só porque cada passada confiou na ordem que a passada anterior já havia estabelecido para os empates.

### MSD radix sort: strings de comprimento variável, da esquerda para a direita

O LSD radix sort exige que toda chave tenha o mesmo comprimento. O MSD (most-significant-digit) radix sort trata strings de comprimento variável trabalhando da esquerda para a direita: contagem-indexada-por-chave no *primeiro* caractere, depois aplica recursivamente o mesmo método a cada bucket resultante (o subarray de strings que compartilham aquele primeiro caractere), avançando para o segundo caractere, e assim por diante — estruturalmente parecido com o quicksort, exceto que o particionamento é por um caractere em até `R` buckets em vez de duas ou três partições baseadas em comparação.

A sutileza é o que fazer quando uma string é mais curta que a posição de caractere sendo examinada no momento. O MSD radix sort trata "além do fim da string" como seu próprio valor de caractere sentinela que ordena *antes* de qualquer caractere real — implementado como `-1`, depois deslocado em `+1` (ou `+2`, junto com o próprio deslocamento do array de contagem) para que ainda possa ser usado como um índice de array não negativo:

```java
public class MSD {
    private static final int R = 256;   // radix
    private static final int M = 15;    // corte para subarrays pequenos
    private static String[] aux;        // array auxiliar para distribuição

    private static int charAt(String s, int d) {
        return d < s.length() ? s.charAt(d) : -1;   // sentinela de fim-de-string
    }

    public static void sort(String[] a) {
        int N = a.length;
        aux = new String[N];
        sort(a, 0, N - 1, 0);
    }

    private static void sort(String[] a, int lo, int hi, int d) {
        // Ordena de a[lo] até a[hi], começando no d-ésimo caractere.
        if (hi <= lo + M) {
            Insertion.sort(a, lo, hi, d);
            return;
        }

        int[] count = new int[R + 2];   // um slot extra para o sentinela

        for (int i = lo; i <= hi; i++)
            count[charAt(a[i], d) + 2]++;

        for (int r = 0; r < R + 1; r++)
            count[r + 1] += count[r];

        for (int i = lo; i <= hi; i++)
            aux[count[charAt(a[i], d) + 1]++] = a[i];

        for (int i = lo; i <= hi; i++)
            a[i] = aux[i - lo];

        // Ordena recursivamente cada bucket (pula r = 0, o bucket de fim-de-string).
        for (int r = 0; r < R; r++)
            sort(a, lo + count[r], lo + count[r + 1] - 1, d + 1);
    }
}
```

A recursão termina numa insertion sort *especializada* assim que um bucket fica pequeno o suficiente (`hi <= lo + M`) — exatamente o mesmo truque de corte-para-insertion-sort usado no quicksort e no mergesort, mas muito mais importante aqui. Sem um corte, ordenar milhões de strings distintas eventualmente dá a cada string seu próprio bucket de tamanho um — e cada um desses buckets minúsculos ainda paga o overhead fixo de alocar e acumular um array `count[]` de `R + 2` entradas. Para `R = 256` esse overhead sozinho pode dominar a ordenação; para Unicode (`R = 65536`) fica bem pior. Sedgewick & Wayne reportam um ganho de velocidade de cerca de 10x ao cortar para insertion sort em buckets de tamanho 10 ou menor numa aplicação típica. A insertion sort usada no corte pula os `d` caracteres iniciais que a recursão já provou serem iguais para toda string no bucket:

```java
public class Insertion {
    public static void sort(String[] a, int lo, int hi, int d) {
        for (int i = lo; i <= hi; i++)
            for (int j = i; j > lo && less(a[j], a[j - 1], d); j--)
                exch(a, j, j - 1);
    }

    private static boolean less(String v, String w, int d) {
        return v.substring(d).compareTo(w.substring(d)) < 0;
    }
}
```

### Ao lado, um trade-off: 3-way radix quicksort para alfabetos grandes

A fraqueza do MSD radix sort é o tamanho do alfabeto `R`: toda chamada recursiva aloca e acumula um array de tamanho aproximadamente `R`, mesmo para um bucket contendo só uma ou duas strings. Isso é barato para `R = 256` (ASCII estendido), mas pode ser desastroso para `R = 65536` (Unicode) — muitos buckets majoritariamente vazios, pagos a cada chamada.

O 3-way radix quicksort é o híbrido que resolve isso: em vez de particionar o caractere atual em `R` buckets, ele particiona-em-3-vias o caractere atual exatamente como o particionamento 3-way do quicksort (Capítulo 2) — em "menor que", "igual a", e "maior que" o caractere pivô — e só recursa para o próximo caractere na partição *igual*:

```java
private static void sort(String[] a, int lo, int hi, int d) {
    if (hi <= lo) return;
    int lt = lo, gt = hi;
    int v = charAt(a[lo], d);
    int i = lo + 1;
    while (i <= gt) {
        int t = charAt(a[i], d);
        if      (t < v) exch(a, lt++, i++);
        else if (t > v) exch(a, i, gt--);
        else            i++;
    }
    // a[lo..lt-1] < v = a[lt..gt] < a[gt+1..hi]
    sort(a, lo, lt - 1, d);
    if (v >= 0) sort(a, lt, gt, d + 1);
    sort(a, gt + 1, hi, d);
}
```

Isso nunca depende de `R` de forma alguma — sempre produz exatamente três partições, seja qual for o alfabeto — e não precisa de array auxiliar, só da pilha de recursão implícita, diferente do `aux[]` e `count[]` do MSD radix sort. O custo é fazer mais movimentação de dados para alcançar o mesmo efeito de um particionamento multivias único, já que uma única divisão estilo MSD em muitos buckets agora leva uma série de particionamentos 3-way em vez de uma passada. É o método de escolha sempre que as chaves compartilham prefixos comuns longos ou vêm de um alfabeto grande — exatamente as situações onde o overhead por chamada do MSD radix sort para de compensar.

## Trade-offs

- **LSD radix sort exige chaves de comprimento fixo** — não tem noção de "além do fim da string", então chaves de comprimento variável exigem padding ou uma adaptação separada; quando essa restrição é satisfeita (endereços IP, códigos de largura fixa), é tempo linear (`~7WN + 3WR` acessos a array) e difícil de superar.
- **Os dois radix sorts quebram o limite inferior N log N por comparação simplesmente não comparando** — eles indexam diretamente num array usando o valor de um caractere, algo que uma ordenação baseada em `compareTo()` nunca consegue fazer; é *por isso* que conseguem ser mais rápidos que até uma ordenação por comparação ótima, não só um ajuste de fator constante.
- **O desempenho do MSD radix sort depende dos dados, não só de N** — para strings aleatórias é sublinear (para assim que as chaves são distinguidas), mas para entradas com muitas chaves iguais ou prefixos comuns longos ele degrada rumo ao mesmo custo linear-no-total-de-caracteres do LSD, e o overhead `O(R)` do array `count[]` por chamada pode dominar para buckets pequenos ou alfabetos grandes sem o corte para insertion sort.
- **Na prática, a própria ordenação de `String` do Java não usa nada disso** — `Arrays.sort()` em `String[]` depende de `String.compareTo()`, que o JDK implementa com eficiência suficiente para que, segundo a própria avaliação de Sedgewick & Wayne, ordenações padrão baseadas em comparação continuem competitivas com radix sorts feitos à mão para chaves `String` comuns; radix sort sobre `char[]` cru é uma ferramenta de especialista para quando você tem volumes enormes de strings e já perfilou `compareTo()` como o gargalo.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 5.1 "String Sorts", pp. 702-725 — book
- [Princeton Algorithms, 4th Ed. — Radix Sorts (companion site)](https://algs4.cs.princeton.edu/51radix/) — doc
- [String#compareTo — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#compareTo(java.lang.String)) — doc
