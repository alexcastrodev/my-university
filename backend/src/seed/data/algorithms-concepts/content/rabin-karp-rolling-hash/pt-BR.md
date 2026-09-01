---
version: 1.0
updatedAt: 2026-08-13
title: "Rabin-Karp: Hashes Rolantes e Busca por Fingerprint"
description: "Uma busca de substring baseada em hashing: gera o fingerprint do padrão uma vez, depois desliza uma janela pelo texto atualizando seu hash em O(1) por passo via uma recorrência de hash rolante, recorrendo à comparação de caracteres apenas em caso de match de hash — cobre a sutileza da colisão, o trade-off de corretude Las Vegas/Monte Carlo, e o caso de uso de detecção de plágio multi-padrão que KMP e Boyer-Moore não generalizam tão naturalmente."
---
## Objetivo

O concept de KMP construiu um autômato a partir do padrão; Boyer-Moore construiu uma tabela de salto a partir dele. Rabin-Karp não faz nenhum dos dois — é uma "abordagem completamente diferente... baseada em hashing" (Sedgewick & Wayne): calcule um fingerprint numérico do padrão de M caracteres uma vez, depois deslize uma janela de M caracteres pelo texto, calculando esse mesmo fingerprint para cada janela em O(1) por deslize, e só recorra a uma comparação de caractere real quando dois fingerprints coincidirem. O concept de KMP já sinalizou Rabin-Karp como a nota lateral de trade-off que merecia sua própria profundidade; este concept a entrega — a aritmética do hash rolante que torna o deslize O(1) possível, a sutileza de corretude que um match de hash sozinho não consegue resolver (uma colisão), e a busca multi-padrão que essa técnica habilita e que nem KMP nem Boyer-Moore generalizam com a mesma naturalidade.

## Casos de Uso

- **Detecção de plágio e conteúdo duplicado.** Sistemas reais (as ferramentas estilo MOSS pelas quais este problema é famoso) fazem hash de janelas sobrepostas de um documento em um conjunto de fingerprints, depois checam os fingerprints de janela de outro documento contra esse conjunto — transformando "alguma substring do documento B combina com alguma substring do documento A" em um lote de buscas O(1) em hash-set, em vez de uma busca por par de documentos. Esse é o grande diferencial de Rabin-Karp: tanto o autômato do KMP quanto a tabela de salto do Boyer-Moore são construídos para *um* padrão contra *um* texto.
- **Varredura de múltiplas assinaturas.** Buscar em um texto por qualquer uma de um grande conjunto de padrões conhecidos ao mesmo tempo (assinaturas de malware, listas de frases banidas) generaliza de forma limpa sob Rabin-Karp — faça o hash de todo padrão em um conjunto uma vez, depois deslize um único hash rolante pelo texto fazendo uma busca O(1) em conjunto por posição — onde rodar KMP ou Boyer-Moore uma vez por padrão custa um múltiplo do comprimento do texto por padrão.
- **Deduplicação com endereçamento por conteúdo.** Ferramentas que detectam blocos de dados duplicados ou deslocados (transferência delta estilo rsync, dedup de armazenamento) dependem do mesmo truque de hash rolante para gerar fingerprint de toda janela possível de um stream de bytes de forma barata, sem nunca pagar o custo de fazer hash de cada janela do zero.

## Aprofundamento

### Hash-então-verifique: fingerprints, e por que um match de hash não é prova de um match

Uma string de comprimento M é apenas um número base-R de M dígitos (R = o tamanho do alfabeto — 256 para ASCII estendido). O fingerprint do padrão é esse número reduzido módulo um primo grande Q: `patHash = value(pat) mod Q`. Buscar significa calcular a mesma redução para toda janela de M caracteres do texto e compará-la com `patHash`. Feito de forma ingênua — recalcular o hash de uma janela a partir de todos os seus M caracteres toda vez que a janela desliza — isso custa O(M) por posição, O(NM) no total: não melhor que força bruta, e Sedgewick & Wayne dizem exatamente isso ("uma implementação direta baseada nessa descrição seria muito mais lenta que uma busca por força bruta"). O ganho só aparece uma vez que o hash da *próxima* janela pode ser derivado do *atual* em O(1) — o hash rolante, coberto a seguir.

Antes disso, porém, uma sutileza de corretude precisa ser resolvida: duas janelas diferentes podem gerar o mesmo valor de hash. `ts ≡ p (mod Q)` **não** implica `ts = p` — só descarta uma discordância (Cormen et al.: "se `ts ≠ p (mod q)`, então você definitivamente sabe que `ts ≠ p`"). Um match de hash é um *candidato*, não uma ocorrência confirmada, até que algo resolva a possibilidade de ser uma coincidência. A própria Figura 32.4 de CLRS torna isso concreto com `Q = 13` (pequeno de propósito, para tornar colisões prováveis o suficiente para observar à mão). Texto `2 3 5 9 0 2 3 1 4 1 5 2 6 7 3 9 9 2 1` (19 dígitos, indexado a partir de 0), padrão `31415` (`M = 5`), cujo valor mod 13 é 7 (`31415 mod 13 = 7`, já que `13 × 2416 = 31408`):

- **Deslocamento s = 6**: `txt[6..10] = "31415"` — o padrão literal. Seu valor mod 13 é 7 — um match de hash, e desta vez real.
- **Deslocamento s = 12**: `txt[12..16] = "67399"`. `67399 mod 13 = 7` também (`13 × 5184 = 67392`, resto 7) — o *mesmo* valor de hash, mas `"67399" ≠ "31415"`. Um hit espúrio: o hash colidiu mesmo com as substrings sendo diferentes.

Duas janelas, mesmo fingerprint, só uma delas uma ocorrência real — é exatamente por isso que o design de Rabin-Karp precisa decidir, de antemão, o que fazer quando o hash der match: verificar com uma comparação de caractere real, ou confiar no hash e aceitar alguma chance de estar errado. Essa decisão é a divisão Las Vegas/Monte Carlo coberta no terceiro subtópico abaixo.

### O hash rolante: derivando o hash da próxima janela a partir do atual em O(1)

Trate os M caracteres de uma janela começando na posição `i` do texto como dígitos de um número base-R, dígito mais significativo primeiro, e reduza mod Q:

```
hash(i) = (a[i]·R^(M-1) + a[i+1]·R^(M-2) + ... + a[i+M-1]·R^0) mod Q
```

Deslizar a janela uma posição à direita descarta `a[i]` (o antigo dígito líder), desloca todo dígito restante uma casa para cima (multiplica por R), e traz `a[i+M]` (o novo dígito final):

```
newHash = ((hash - a[i]·R^(M-1)) · R + a[i+M]) mod Q
```

`R^(M-1) mod Q` — o peso do dígito prestes a sair — é a mesma constante em todo deslize, então é calculado apenas uma vez, antes da varredura começar, e reutilizado: Sedgewick & Wayne o chamam de `RM`. Essa única pré-computação é o que transforma cada deslize em um número fixo de operações aritméticas, independente de M — a razão inteira de isso superar recalcular do zero.

```java
public class RabinKarp {
    private final String pat;
    private final long patHash;   // fingerprint do padrão
    private final int M;          // comprimento do padrão
    private final long Q;         // um primo grande usado como módulo
    private final int R = 256;    // tamanho do alfabeto
    private final long RM;        // R^(M-1) % Q, pré-computado uma vez

    public RabinKarp(String pat) {
        this.pat = pat;
        this.M = pat.length();
        this.Q = longRandomPrime(); // um primo grande, bem escolhido
        long rm = 1;
        for (int i = 1; i <= M - 1; i++)
            rm = (R * rm) % Q;      // RM = R^(M-1) % Q
        this.RM = rm;
        this.patHash = hash(pat, M);
    }

    private long hash(String key, int m) { // regra de Horner, mod Q o tempo todo
        long h = 0;
        for (int j = 0; j < m; j++)
            h = (R * h + key.charAt(j)) % Q;
        return h;
    }

    public int search(String txt) {
        int N = txt.length();
        long txtHash = hash(txt, M);
        if (patHash == txtHash) return 0;
        for (int i = M; i < N; i++) {
            // remove o dígito líder, desloca, adiciona o dígito final — O(1) por deslize
            txtHash = (txtHash + Q - RM * txt.charAt(i - M) % Q) % Q;
            txtHash = (txtHash * R + txt.charAt(i)) % Q;
            if (patHash == txtHash && check(txt, i - M + 1))
                return i - M + 1;
        }
        return N; // não encontrado
    }

    private boolean check(String txt, int offset) { // verificação Las Vegas — veja abaixo
        return txt.regionMatches(offset, pat, 0, M);
    }
}
```

(`+ Q` antes da subtração mantém o valor intermediário não negativo para que `%` se comporte como esperado — o `%` do Java pode retornar um resultado negativo para um operando esquerdo negativo.)

Um exemplo resolvido verificado à mão, reutilizando os próprios números de Sedgewick & Wayne: padrão `"26535"` (`M = 5`), texto `"3141592653589793"`, `R = 10`, `Q = 997`. `RM = 10^4 mod 997 = 30`. `patHash = 26535 mod 997 = 613`. O hash da primeira janela, `31415 mod 997`, é 508 — sem match, então desliza:

| janela | dígito saindo | atualização | novo hash |
|---|---|---|---|
| `31415` | — | `31415 mod 997` | **508** |
| `14159` | 3 | `(508 − 3·30)·10 + 9 = 4189`, `mod 997` | **201** |
| `41592` | 1 | `(201 − 1·30)·10 + 2 = 1712`, `mod 997` | **715** |
| `15926` | 4 | `(715 − 4·30)·10 + 6 = 5956`, `mod 997` | **971** |
| `59265` | 1 | `(971 − 1·30)·10 + 5 = 9415`, `mod 997` | **442** |
| `92653` | 5 | `(442 − 5·30)·10 + 3 = 2923`, `mod 997` | **929** |
| `26535` | 9 | `(929 − 9·30)·10 + 5 = 6595`, `mod 997` | **613** ← match |

Seis não-matches, cada um calculado a partir do anterior em um punhado fixo de operações aritméticas, depois um match de hash na sétima janela que também é um match de substring genuíno (`"26535"` é literalmente o padrão) — `search()` retorna `i = 6`.

O modo `type: moves` do motor de visualização mereceu uma tentativa genuína aqui antes de recorrer à tabela acima. Seu comando `mark` destaca exatamente uma posição de array por passo — sem swap, sem intervalo multi-posição — então o ajuste honesto mais próximo é marcar o índice *mais à direita* de cada janela conforme ela desliza, uma posição por passo, combinando com a forma como os concepts irmãos de KMP e Boyer-Moore usam um array de texto de linha única:

```viz
type: moves
mark 4 | Janela0 = txt[0..4] = "31415". hash = 31415 mod 997 = 508. Hash do padrão ("26535") = 613 — sem match, desliza à direita.
mark 5 | Janela1 = txt[1..5] = "14159". Atualização rolante: (508 − 3·30)·10 + 9 mod 997 = 201 — ainda sem match. (Dígito saindo 3, peso RM = 30.)
mark 6 | Janela2 = txt[2..6] = "41592". (201 − 1·30)·10 + 2 mod 997 = 715 — sem match.
mark 7 | Janela3 = txt[3..7] = "15926". (715 − 4·30)·10 + 6 mod 997 = 971 — sem match.
mark 8 | Janela4 = txt[4..8] = "59265". (971 − 1·30)·10 + 5 mod 997 = 442 — sem match.
mark 9 | Janela5 = txt[5..9] = "92653". (442 − 5·30)·10 + 3 mod 997 = 929 — sem match.
mark 10 | Janela6 = txt[6..10] = "26535". (929 − 9·30)·10 + 5 mod 997 = 613 — match de hash, e a substring realmente é "26535": search() retorna i = 6.
---
3
1
4
1
5
9
2
6
5
3
5
8
9
7
9
3
```

Onde isso genuinamente fica aquém dos traces irmãos: as posições marcadas de KMP e Boyer-Moore *são* o mecanismo — uma comparação de caractere acontecendo em um índice específico do array. O mecanismo de Rabin-Karp é o próprio número de hash, que não é uma posição em nenhum array e por isso nunca pode aparecer na linha que o motor renderiza — só no texto da legenda. O motor também não tem como destacar os cinco caracteres de uma janela de uma vez (só uma posição por `mark`), então a única marca do índice final funciona como substituta de "a janela atualmente sob teste", em vez de mostrá-la de fato. Um trace impresso, passo a passo — a tabela acima — expõe o estado real (a janela, seu hash, o hash do padrão, match ou não) diretamente, o que é por que ela é a apresentação primária aqui e o bloco `viz` é uma ilustração secundária, honestamente ressalvada, em vez da principal.

### Las Vegas vs. Monte Carlo: o que acontece quando o hash dá match

Uma vez encontrado um match de hash, existem exatamente duas escolhas disciplinadas, e o próprio enquadramento de Rabin & Karp (via Sedgewick & Wayne) as nomeia com precisão:

- **Monte Carlo**: confie no match de hash como um match real, sem nenhuma verificação caractere-a-caractere. Isso dá um tempo de execução O(N + M) incondicional — todo deslize é O(1), e não há passo de verificação para jamais desacelerar — ao custo de uma probabilidade pequena e não nula de reportar um falso positivo (uma colisão de hash confundida com um match). Sedgewick & Wayne: "um exemplo antigo e famoso de algoritmo Monte Carlo que tem tempo de conclusão garantido mas falha em produzir uma resposta correta com uma pequena probabilidade."
- **Las Vegas**: verifique todo match de hash com uma comparação real dos M caracteres antes de reportá-lo (a chamada `check()` no código acima). Isso garante corretude incondicionalmente, ao custo de degradar em direção ao O(NM) da força bruta no caso patológico em que muitos hits espúrios ocorrem e cada um precisa ser individualmente descartado por uma comparação O(M).

A Propriedade P de Sedgewick & Wayne enuncia o par com exatidão: "A versão Monte Carlo da busca de substring de Rabin-Karp é de tempo linear e extremamente provável de estar correta, e a versão Las Vegas da busca de substring de Rabin-Karp é correta e extremamente provável de ser de tempo linear." Nenhuma das versões recebe as duas garantias incondicionalmente — uma ou outra precisa ser sacrificada.

O que torna essa uma troca segura na prática é o módulo Q. Reduzir valores módulo Q se comporta, para um Q bem escolhido, como um mapeamento aleatório do alfabeto em `{0, ..., Q-1}` — a análise heurística de Cormen et al. coloca o número esperado de hits espúrios em `O(n/q)`. Sedgewick & Wayne vão além e simplesmente escolhem Q enorme — "um valor longo maior que 10^20" — já que Rabin-Karp nunca de fato constrói uma tabela hash de tamanho Q (só existe uma chave, o padrão, sendo checado), então não há custo em escolher Q muito maior do que qualquer tabela real conseguiria pagar. Rabin e Karp mostraram que a probabilidade de colisão para um Q bem escolhido é de cerca de `1/Q`; em `Q > 10^20` isso é uma probabilidade baixa o suficiente que Sedgewick & Wayne notam que você pode elevá-la ao quadrado novamente (rodar o algoritmo duas vezes) para empurrar a probabilidade de falha para abaixo de 10^-40, se isso ainda não for tranquilizador o bastante. Na prática, isso torna o pequeno risco do Monte Carlo próximo do teórico, e não operacional — mas Las Vegas continua sendo a única versão com uma garantia de corretude real, e custa apenas o passo de verificação (extremamente raro, com um bom Q grande) para consegui-la.

### O diferencial multi-padrão, e o tempo de execução esperado

Tanto o pré-processamento quanto a busca são baratos: calcular o hash do padrão e `RM` é Θ(M) (a regra de Horner toca cada caractere do padrão uma vez), e Cormen et al. dão Θ(n − m + 1) para os cálculos de hash da fase de busca. A pegadinha — a razão de isso ser enunciado como *esperado*, em vez de pior caso, diferente da Proposição N incondicional do KMP — é o custo de verificação. Se o número esperado de matches *válidos* for O(1) e Q for escolhido maior que o comprimento do padrão, o limite de Cormen et al. é `O(n) + O(m·(v + n/q))`, que colapsa para O(N + M) exatamente quando hits espúrios permanecem raros, ou seja, quase sempre, para um Q grande. A própria tabela-resumo de custo de Sedgewick & Wayne coloca as duas versões de Rabin-Karp em "7N" operações típicas contra o 1.1N da força bruta ou o N/M do Boyer-Moore — o custo por passo aqui não é uma única comparação de caractere, mas "várias operações aritméticas" (uma multiplicação, uma soma, um resto), então o fator constante é real mesmo que a classe assintótica seja a melhor dos quatro algoritmos cobertos por esse trio de concepts.

A história do tempo de execução, porém, não é a razão para recorrer a Rabin-Karp em vez de KMP ou Boyer-Moore — ambos já entregam tempo linear ou sublinear para um único padrão com uma garantia de pior caso mais rígida. A razão é que Rabin-Karp é o único dos três cujo mecanismo central *generaliza* para muitos padrões de uma vez quase de graça. Hashing é simétrico: nada em "calcule um fingerprint, procure-o" se importa se o alvo da busca é um único valor armazenado ou um conjunto de milhares. Faça o hash de todo padrão em um conjunto candidato para um `HashSet<Long>` uma vez; depois deslize um único hash rolante pelo texto, e cada janela custa uma atualização de hash O(1) mais uma busca em conjunto O(1) em caso médio, independente de quantos padrões estão sendo buscados simultaneamente. É genuinamente assim que detectores de plágio e sistemas de conteúdo duplicado funcionam na prática — fazendo hash de janelas sobrepostas de um documento em um conjunto de fingerprints, depois checando as janelas de outro documento contra ele — e nem o autômato por padrão do KMP nem a tabela de salto por padrão do Boyer-Moore se estende a "muitos padrões, uma passada sobre o texto" com essa mesma limpeza; cada um precisaria ser reconstruído e re-executado uma vez por padrão.

## Trade-offs

- **Espaço extra constante — o melhor dos três algoritmos nesse eixo.** Rabin-Karp precisa de O(1) de espaço além da entrada (só o hash rolante e algumas constantes pré-computadas), contra o DFA O(MR) do KMP ou a tabela de salto O(R) do Boyer-Moore. Também é o mais barato de pré-processar no sentido de que não há tabela alguma para construir — só um cálculo de hash Θ(M).
- **Um custo real de fator constante por passo.** Cada deslize é uma multiplicação, uma subtração, uma soma e duas operações de módulo — a própria tabela comparativa de Sedgewick & Wayne classifica isso em ~7N operações típicas contra o ~1.1N da força bruta ou o ~N/M do Boyer-Moore. Rabin-Karp vence assintoticamente e em generalidade, não em velocidade bruta de fator constante para um único padrão comum.
- **Monte Carlo preserva a propriedade de streaming que Las Vegas abre mão.** A tabela de custo de Sedgewick & Wayne registra isso com precisão: a versão Monte Carlo não precisa de backup no texto — nunca relê um caractere já consumido, a mesma propriedade amigável a streaming que torna KMP atraente para entrada não bufferizada — enquanto o passo de verificação da versão Las Vegas relê os M caracteres da janela para confirmar um match de hash, o que exige backup. Corretude garantida e streaming em passada única estão, neste algoritmo, em tensão um com o outro.
- **O caso multi-padrão é a razão genuína para recorrer a este em vez dos concepts irmãos**, não velocidade de padrão único — veja o último subtópico do Aprofundamento. Para um único padrão contra um único texto em memória, os saltos sublineares no caso típico do Boyer-Moore ou a garantia linear incondicional do KMP costumam ser a escolha mais bem justificada.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.3 "Substring Search", Rabin-Karp fingerprint search, pp. 774-779 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Section 32.2 "The Rabin-Karp Algorithm", pp. 962-966 — book
- [Princeton Algorithms, 4th Ed. — Substring Search (companion site)](https://algs4.cs.princeton.edu/53substring/) — doc
- [HashSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html) — doc
