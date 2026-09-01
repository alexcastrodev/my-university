---
version: 1.0
updatedAt: 2026-08-18
title: "Bloom Filters: Pertencimento Probabilístico a Conjuntos"
description: "Um Bloom filter responde \"esta chave poderia estar no conjunto?\" usando um array de bits de tamanho fixo e k funções de hash independentes em vez de armazenar qualquer chave, garantindo zero falsos negativos ao aceitar uma taxa de falso positivo pequena e precisamente ajustável — trocando exatidão por buscas O(k) e espaço O(m) que nunca depende do tamanho ou tipo da chave."
---
## Objetivo

Entenda o Bloom filter: uma estrutura de dados probabilística que responde "esta chave poderia estar no conjunto?" usando nada além de um array de bits de tamanho fixo e um punhado de funções de hash independentes — nenhuma chave é de fato armazenada. Essa troca produz uma estrutura com uma taxa de falso positivo pequena e precisamente ajustável, tempo O(k) tanto para inserção quanto para teste de pertencimento (k = o número de funções de hash, tipicamente de um dígito), e espaço O(m) que depende só de quantos bits você alocou, nunca do tamanho ou tipo das próprias chaves. O ponto não é substituir um conjunto de verdade — é sentar *na frente* de um (uma hash table, um índice de banco de dados, uma lista encadeada, qualquer coisa) e responder barato "definitivamente não está aqui" com frequência suficiente para pular a busca real, cara.

## Casos de Uso

- A checagem "definitivamente não está em disco" de um cache ou motor de armazenamento antes de um seek caro ou uma ida e volta pela rede — bancos de dados LSM-tree (Cassandra, LevelDB/RocksDB, Bigtable) colocam um Bloom filter na frente de cada segmento em disco especificamente para pular segmentos que não podem conter a chave buscada.
- Clientes leves ("SPV") de blockchain testando se um bloco pode conter uma transação relevante para seus endereços, sem baixar e varrer o bloco inteiro.
- Corretores ortográficos e autocomplete testando se uma palavra pode estar num dicionário grande antes de fazer uma busca exata.
- Qualquer situação em que a estrutura real sendo testada por pertencimento não importa para o filtro — um Bloom filter fica na frente de uma lista encadeada exatamente tão bem quanto de uma hash table ou de uma árvore, já que nunca armazena ou compara as chaves reais, só posições de bit derivadas delas.

## Aprofundamento

### Estrutura: um array de bits, k funções de hash, nada mais

Um Bloom filter é um array de `m` bits, todos inicializados em `0`, mais `k` funções de hash independentes `h_1, ..., h_k`, cada uma mapeando uma chave arbitrária para uma posição em `{0, ..., m-1}`.

**Inserção** de uma chave `x`: calcule `h_1(x), h_2(x), ..., h_k(x)` e defina todas essas `k` posições de bit como `1`. Nenhuma chave é armazenada em lugar nenhum — só o fato de que essas `k` posições agora são `1`.

**Teste de pertencimento** para uma chave `x`: calcule as mesmas `k` posições e checa se *cada uma* delas está atualmente em `1`. Se mesmo um dos `k` bits for `0`, `x` **definitivamente nunca foi inserido** — essa é uma garantia rígida, não uma probabilidade. Se todos os `k` bits forem `1`, o filtro relata `x` como (provavelmente) presente — mas isso pode ser um **falso positivo**: esses bits poderiam todos ter sido definidos como `1` por colisões de hash de *outras* chaves, sem `x` jamais ter sido inserido de fato.

**Exemplo resolvido** (espelhando um pequeno filtro traçado à mão com `m = 15` bits e `k = 3` funções de hash): insira a chave `x` com `h1(x)=2, h2(x)=5, h3(x)=11`, depois a chave `y` com `h1(y)=4, h2(y)=8, h3(y)=11`:

```
slot:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
bit:   0  0  1  0  1  1  0  0  1  0  0  1  0  0  0
                ^x       ^x          ^x&y   ^y (via slot 4, 8)
```

Tanto `x` quanto `y` por acaso fazem hash para o slot `11` sob sua terceira função de hash — uma **colisão genuína entre os conjuntos de bits de duas chaves diferentes**. Isso não é um erro ou um bug a corrigir; é o mecanismo inteiro pelo qual falsos positivos acontecem. Se uma terceira chave `z` (nunca inserida) por acaso fizesse hash para exatamente `{2, 8, 11}` — misturando bits que `x` e `y` já haviam definido entre si — o filtro relataria `z` como presente, incorretamente.

### Por que falsos positivos são possíveis mas falsos negativos são impossíveis

Essa assimetria é a garantia definidora do Bloom filter, e decorre diretamente de um fato: **um bit, uma vez definido como `1`, nunca é limpo** por uma inserção normal. Então se `x` realmente foi inserido, todos os seus `k` bits foram definidos como `1` naquele momento e só podem permanecer `1` depois disso (mais inserções só podem definir mais bits, nunca desfazer nenhum) — significando que um teste de pertencimento numa chave verdadeiramente inserida nunca pode falhar. É exatamente o *compartilhamento* de posições de bit entre os resultados de hash de chaves diferentes — visível acima no slot `11` — que abre a porta para um falso positivo: uma chave pode parecer presente puramente porque as inserções de *outras* chaves por acaso definiram todo bit que ela precisaria.

### A derivação da taxa de falso positivo

Sob a suposição simplificadora de hashing uniforme e independente, a probabilidade de um bit específico *não* ser definido por uma função de hash específica é `1 - 1/m`. Com `k` funções de hash independentes, a probabilidade de um dado bit ficar intocado por *todas* as `k` é `(1 - 1/m)^k`. Usando o limite padrão `e = lim_{n→∞} (1 + 1/n)^n`, para `m` grande isso se aproxima de `(1 - 1/m)^k ≈ e^{-k/m}`. Depois que `n` chaves foram inseridas (cada uma definindo `k` bits), a probabilidade de um dado bit ainda ser `0` é `(1 - 1/m)^{kn} ≈ e^{-kn/m}`, então a probabilidade dele ser `1` é `1 - e^{-kn/m}`.

Um falso positivo numa chave que nunca foi inserida exige que *todas* as `k` de suas posições de hash por acaso já estejam em `1` — um evento cuja probabilidade, tratando os bits como independentes (uma aproximação, já que na prática não são exatamente independentes, mas uma boa aproximação), é:

```
p(k, m, n) ≈ (1 - e^{-kn/m})^k
```

**Exemplo resolvido**: `n = 1000` chaves armazenadas em `m = 10000` bits usando `k = 10` funções de hash dá `p ≈ (1 - e^{-1})^{10} ≈ 0.0102` — cerca de 1% de taxa de falso positivo.

**O k ótimo.** Derivando `p(k, m, n)` em relação a `k` e igualando a zero (a derivação substitui `p = e^{-kn/m}` e se reduz a resolver `p = 1 - p`, isto é, `p = 1/2`) obtém-se o número de funções de hash que *minimiza* a taxa de falso positivo para uma razão `m/n` fixa:

```
k_ótimo = (m/n) · ln(2)
```

Para `m = 15`, `n = 3`: `k = 5·ln(2) ≈ 3.465`, arredondado para o número inteiro mais próximo de funções de hash, `k = 3` — batendo com a própria escolha do exemplo resolvido acima. Substituindo `k_ótimo` de volta na fórmula de falso positivo e resolvendo para a razão de bits-por-chave necessária a uma taxa de falso positivo alvo `ε` dá:

```
m/n = -ln(ε) / (ln 2)^2         isto é,  m ≈ -n·ln(ε) / (ln 2)^2
```

Concretamente: mirar em `ε = 0.01` (1%) precisa de `m ≈ 9.585n` bits por chave (para `n = 100` chaves, `m ≈ 959` bits, cerca de 1 KB); mirar em `ε = 0.001` (0.1%) precisa de `m ≈ 14.377n` (para `n = 100`, `m ≈ 1438` bits, cerca de 1.5 KB). Obter uma taxa de falso positivo uma ordem de grandeza melhor custa apenas um aumento linear, não exponencial, em bits por chave — a razão inteira pela qual um Bloom filter pode "aparentemente ter muitos bits" e ainda ter uma complexidade de espaço genuinamente baixa: o tamanho do array depende só de `n` e do `ε` alvo, nunca de quão grandes ou complexas as chaves reais são.

### Sem remoções — o mesmo compartilhamento que causa falsos positivos proíbe a remoção

Como posições de bit são compartilhadas entre resultados de hash de chaves diferentes por design (exatamente o que fez o slot `11` colidir entre `x` e `y` acima), um Bloom filter simples **não pode suportar remoção**. Limpar um bit para "remover" uma chave arrisca também apagar um bit do qual alguma *outra* chave, ainda presente, depende — não há como saber, só a partir do array de bits, se um `1` numa posição é "de propriedade" só da chave sendo removida ou compartilhado com outras. A extensão padrão que adiciona suporte a remoção, um **counting Bloom filter**, substitui cada bit único por um pequeno contador (incrementado na inserção, decrementado na remoção, o teste de pertencimento checa "contador > 0" em vez de "bit == 1") — ao custo de espaço `O(m · log(contagem máxima))` em vez de `O(m)` bits.

### Implementação em Java

Uma implementação real quase nunca calcula `k` funções de hash independentes do zero — a técnica padrão (Kirsch & Mitzenmacher) deriva todas as `k` posições a partir de apenas **duas** funções de hash subjacentes `h1`, `h2` via double hashing:

```java
public class BloomFilter {
    private final BitSet bits;
    private final int m;
    private final int k;

    public BloomFilter(int m, int k) {
        this.bits = new BitSet(m);
        this.m = m;
        this.k = k;
    }

    // Simula k funções de hash independentes a partir de só duas reais:
    // g_i(x) = h1(x) + i * h2(x), para i = 0..k-1 (técnica de Kirsch-Mitzenmacher).
    private int hashAt(Object key, int i) {
        int h1 = key.hashCode();
        int h2 = Integer.reverse(h1) | 1; // ímpar, descorrelacionado de h1
        int combined = h1 + i * h2;
        return Math.floorMod(combined, m);
    }

    public void add(Object key) {
        for (int i = 0; i < k; i++) {
            bits.set(hashAt(key, i));
        }
    }

    public boolean mightContain(Object key) {
        for (int i = 0; i < k; i++) {
            if (!bits.get(hashAt(key, i))) {
                return false; // definitivamente ausente
            }
        }
        return true; // presente, ou um falso positivo
    }
}
```

Kirsch e Mitzenmacher provaram que essa simulação com dois hashes produz assintoticamente a mesma taxa de falso positivo que `k` funções de hash genuinamente independentes — então implementações reais evitam calcular `k` hashes separados e simplesmente variam `i` sobre os mesmos dois.

### Veja acontecendo: inserindo três chaves, cada uma fazendo hash para 3 slots

Cada chave abaixo é listada três vezes seguidas — uma por função de hash simulada `h1/h2/h3` — porque o passo `place` do motor nunca remove um token de um slot que ele já ocupa: colocar o mesmo token num segundo e terceiro slot o torna visualmente presente nos três simultaneamente, batendo exatamente com "essa chave definiu 3 bits". Calculado à mão a partir do mesmo `hash()` (`String.hashCode()` do Java) que o concept irmão de hash table usa: `cat` define os bits `{0, 2, 11}`, `dog` define os bits `{4, 6, 15}`, `pig` define os bits `{4, 7, 10}`. Observe o slot 4, onde o primeiro hash de `dog` e o terceiro hash de `pig` caem no mesmo bit — uma colisão real entre os conjuntos de bits de duas chaves diferentes, precisamente o mecanismo que torna falsos positivos possíveis.

```viz
type: formula
capacity = 20
slot = mod(hash(item) * (1 + mod(index, 3)) + mod(index, 3) * 7, capacity)
---
cat
cat
cat
dog
dog
dog
pig
pig
pig
```

## Trade-offs

- **Falsos positivos são possíveis; falsos negativos são impossíveis.** Essa assimetria é o design inteiro — um Bloom filter só pode errar na direção do "sim", nunca na do "não", porque bits só são definidos, nunca limpos.
- **Espaço é O(m), independente do tamanho ou tipo da chave** — um filtro sobre strings de um milhão de caracteres custa exatamente tantos bits quanto um sobre inteiros simples. Essa é a proposta de valor inteira da estrutura frente a de fato armazenar as chaves.
- **Sem remoção**, a menos que você pague pelo espaço extra de contador por slot de um counting Bloom filter (`O(m · log(contagem máxima))` em vez de `O(m)` bits) — um bit simples não consegue dizer se está "de propriedade" de uma chave ou compartilhado por várias.
- **`m` e `k` precisam ser escolhidos para um `n` esperado, de antemão.** A fórmula de taxa de falso positivo assume um `n` específico; inserir muito mais chaves do que planejado empurra silenciosamente a taxa real de falso positivo acima do alvo de design, já que o array de bits nunca é redimensionado.
- **A taxa de falso positivo é ajustável, barato** — ir de um alvo de 1% para um de 0.1% custa aproximadamente 1.5x mais bits por chave (9.585n → 14.377n), não uma ordem de grandeza a mais; o tamanho escala linearmente em `-ln(ε)`, não em `1/ε`.

## Documentation Links

- [Burton H. Bloom, "Space/Time Trade-offs in Hash Coding with Allowable Errors," Communications of the ACM, Vol. 13, No. 7 (1970), pp. 422-426](https://dl.acm.org/doi/10.1145/362686.362692) — paper
- [Adam Kirsch, Michael Mitzenmacher, "Less Hashing, Same Performance: Building a Better Bloom Filter," ESA 2006](https://link.springer.com/chapter/10.1007/11841036_42) — paper
- [Bloom filter — Wikipedia](https://en.wikipedia.org/wiki/Bloom_filter) — doc
