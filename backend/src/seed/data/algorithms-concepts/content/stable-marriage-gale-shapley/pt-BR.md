---
version: 1.0
updatedAt: 2026-08-14
title: "O Problema do Casamento Estável e o Algoritmo de Gale-Shapley"
description: "Dado um grafo bipartido completo em que todo vértice ranqueia os vértices do outro lado, o algoritmo de Gale-Shapley sempre encontra um matching sem par bloqueador — e provadamente dá a cada proponente seu melhor parceiro alcançável entre todos os matchings estáveis, ao custo de dar a cada vértice proposto seu pior."
---
## Objetivo

Entenda o **problema do casamento estável**: dado um grafo bipartido completo `G = (V, E)` com partição de vértices `V = L ∪ R` (`|L| = |R| = n`), onde todo vértice ainda carrega um ranking de todo vértice do outro lado, encontre um matching de `L` para `R` que seja **estável** — nenhum par de vértices não emparelhados entre si prefere um ao outro em vez de seus parceiros atribuídos. Cormen, Leiserson, Rivest, Stein enquadram isso como uma extensão direta do problema de bipartite matching da Seção 25.1: lá, o objetivo era só *um* matching máximo; aqui, o ranking de cada vértice sobre o outro lado permite perguntar qual matching é *mais desejável*. O **algoritmo de Gale-Shapley** é o procedimento simples que sempre produz um matching estável, não importa quais rankings os vértices forneçam.

## Casos de Uso

- Qualquer grafo bipartido completo onde os dois lados ranqueiam o lado oposto e você precisa de um matching que ninguém tenha incentivo para quebrar — o formato geral que o problema do casamento estável modela, independentemente do enquadramento de "casamento".
- O National Resident Matching Program — que casa residentes médicos com hospitais — é a instância do mundo real citada pelo CLRS, embora difira da configuração pura do casamento estável de duas formas que o texto destaca: um hospital pode aceitar múltiplos residentes, e o número de residentes não precisa ser igual ao número de hospitais, então o algoritmo base precisa de modificação para se encaixar nisso.
- Decidir, entre vários matchings válidos de um grafo bipartido, qual atribuir de fato — a estabilidade filtra matchings que seriam imediatamente desfeitos por um par "optando por sair" de suas atribuições e se emparelhando por conta própria.

## Aprofundamento

### De bipartite matching a matching estável: pares bloqueadores

O CLRS monta o problema num grafo bipartido completo `G = (V, E)` com `V = L ∪ R`, `|L| = |R| = n`, contendo uma aresta de todo vértice em `L` para todo vértice em `R`. Todo vértice em `L` tem uma lista ordenada ranqueando todos os vértices em `R`, e vice-versa. Tradicionalmente `L` é visto como um conjunto de mulheres e `R` como um conjunto de homens, cada um ranqueando todos os membros do outro lado por desejabilidade.

O objetivo é parear mulheres e homens — um matching — de forma que, se uma mulher e um homem *não* estão pareados entre si, pelo menos um deles prefere seu parceiro atribuído. Se uma mulher e um homem não estão pareados entre si mas cada um prefere o outro em vez de seu parceiro atribuído, eles formam um **par bloqueador**: têm incentivo para sair do pareamento atribuído e ficar juntos por conta própria. Um matching sem par bloqueador é **estável**; um matching com par bloqueador é **instável**.

### Exemplo resolvido — um matching estável único

Quatro mulheres — Wanda, Emma, Lacey e Karen — e quatro homens — Oscar, Davis, Brent e Hank — têm estas preferências:

```
Wanda: Brent, Hank, Oscar, Davis
Emma:  Davis, Hank, Oscar, Brent
Lacey: Brent, Davis, Hank, Oscar
Karen: Brent, Hank, Davis, Oscar
Oscar: Wanda, Karen, Lacey, Emma
Davis: Wanda, Lacey, Karen, Emma
Brent: Lacey, Karen, Wanda, Emma
Hank:  Lacey, Wanda, Emma, Karen
```

Um matching estável para essa instância é:

```
Lacey e Brent
Wanda e Hank
Karen e Davis
Emma e Oscar
```

Esse matching não tem par bloqueador. Por exemplo, mesmo que Karen prefira Brent e Hank ao seu parceiro Davis, Brent prefere sua parceira Lacey a Karen, e Hank prefere sua parceira Wanda a Karen — então nem Karen-Brent nem Karen-Hank bloqueiam o matching. Na verdade esse matching estável é único para essa instância: se em vez disso os últimos dois pares fossem Emma-Davis e Karen-Oscar, então Karen e Davis formariam um par bloqueador (eles não estão pareados juntos, Karen prefere Davis a Oscar, e Davis prefere Karen a Emma) — então esse matching alternativo é instável.

### Matchings estáveis não precisam ser únicos

A estabilidade não determina uma única resposta em geral. Com três mulheres — Monica, Phoebe e Rachel — e três homens — Chandler, Joey e Ross:

```
Monica:  Chandler, Joey, Ross
Phoebe:  Joey, Ross, Chandler
Rachel:  Ross, Chandler, Joey
Chandler: Phoebe, Rachel, Monica
Joey:     Rachel, Monica, Phoebe
Ross:     Monica, Phoebe, Rachel
```

existem três matchings estáveis:

| Matching 1 | Matching 2 | Matching 3 |
|---|---|---|
| Monica e Chandler | Phoebe e Chandler | Rachel e Chandler |
| Phoebe e Joey | Rachel e Joey | Monica e Joey |
| Rachel e Ross | Monica e Ross | Phoebe e Ross |

No matching 1, todas as mulheres têm sua primeira escolha e todos os homens têm sua última escolha; o matching 2 é o oposto; no matching 3, todo mundo tem sua segunda escolha. Quando todas as mulheres (ou todos os homens) têm sua primeira escolha claramente não pode haver par bloqueador, e o matching 3 também pode ser verificado como não tendo nenhum.

### O algoritmo de Gale-Shapley

O algoritmo de Gale-Shapley sempre encontra um matching estável, para quaisquer rankings que os participantes forneçam. Ele tem duas variantes espelhadas, "orientada a mulheres" e "orientada a homens"; o CLRS apresenta a versão orientada a mulheres e observa que a versão orientada a homens só inverte os papéis de homens e mulheres.

Todo participante começa **livre**. Uma mulher livre propõe a um homem; quando um homem recebe uma proposta pela primeira vez ele passa de livre para **noivo**, e uma vez noivo ele permanece noivo (embora não necessariamente da mesma mulher). Se um homem noivo recebe uma proposta de uma mulher que ele prefere à sua parceira atual, ele quebra esse noivado — a mulher abandonada volta a ficar livre — e fica noivo da nova pretendente em vez disso. Cada mulher propõe descendo sua lista de preferências, em ordem, pulando homens a quem já propôs, parando só quando fica noiva; se depois ela ficar livre de novo, ela retoma de onde parou na lista. O algoritmo termina quando todo mundo está noivo:

```
GALE-SHAPLEY(homens, mulheres, rankings)
1  atribua toda mulher e todo homem como livres
2  enquanto alguma mulher w está livre
3      seja m o primeiro homem na lista ranqueada de w a quem ela ainda não propôs
4      se m está livre
5          w e m ficam noivos um do outro (e não mais livres)
6      senão-se m ranqueia w mais alto que a mulher w' com quem ele está noivo atualmente
7          m quebra o noivado com w', que fica livre
8          w e m ficam noivos um do outro (e não mais livres)
9      senão m rejeita w, e w permanece livre
10 retorne o matching estável formado pelos pares noivos
```

A linha 2 permite uma escolha — qualquer mulher livre pode ser selecionada — e o algoritmo produz um matching estável independentemente dessa escolha (veja o Teorema 25.11 abaixo).

**Rastreando no exemplo de Wanda/Emma/Lacey/Karen/Oscar/Davis/Brent/Hank**, uma possível sequência de iterações:

1. Wanda propõe a Brent. Brent está livre, então ficam noivos.
2. Emma propõe a Davis. Davis está livre, então ficam noivos.
3. Lacey propõe a Brent. Brent está noivo de Wanda mas prefere Lacey; ele quebra o noivado (Wanda fica livre), e Lacey e Brent ficam noivos.
4. Karen propõe a Brent. Brent está noivo de Lacey, que ele prefere a Karen; ele rejeita Karen, que permanece livre.
5. Karen propõe a Hank. Hank está livre, então ficam noivos.
6. Wanda propõe a Hank. Hank está noivo de Karen mas prefere Wanda; ele quebra o noivado (Karen fica livre), e Wanda e Hank ficam noivos.
7. Karen propõe a Davis. Davis está noivo de Emma mas prefere Karen; ele quebra o noivado (Emma fica livre), e Karen e Davis ficam noivos.
8. Emma propõe a Hank. Hank está noivo de Wanda, que ele prefere a Emma; ele rejeita Emma, que permanece livre.
9. Emma propõe a Oscar. Oscar está livre, então ficam noivos.

Nesse ponto todo mundo está noivo, o laço `enquanto` termina, e o procedimento retorna exatamente o matching estável mostrado antes (Lacey-Brent, Wanda-Hank, Karen-Davis, Emma-Oscar).

### Corretude: Gale-Shapley sempre termina sem par bloqueador

**Teorema 25.9.** O procedimento sempre termina e retorna um matching estável.

*Terminação.* Por contradição: se o laço nunca termina, alguma mulher permanece livre para sempre. Para isso acontecer ela precisa ter proposto a todo homem e sido rejeitada por cada um — mas um homem só pode rejeitar quando já está noivo, então todos os homens estariam noivos. Uma vez noivo, um homem nunca fica livre de novo, e há tantas mulheres quanto homens, então toda mulher teria que estar noiva também — contradizendo a suposição de que ela permaneceu livre. Para o *limite* de iterações: cada uma das `n` mulheres passa por no máximo `n` homens em seu ranking, então o laço roda no máximo `n²` iterações.

*Nenhum par bloqueador.* Uma vez que um homem `m` está noivo, todas as suas ações subsequentes ocorrem nas linhas 6–8: sempre que ele quebra um noivado, é por uma mulher que ele prefere à que ele está deixando. Suponha que a mulher `w` acabe pareada com `m` mas prefira algum `m'`. Como `w` ranqueia `m'` acima de `m`, ela precisa ter proposto a `m'` antes de `m`, e `m'` ou a rejeitou (já noivo de alguém que ele preferia) ou aceitou e depois quebrou (por alguém que ele preferia ainda mais). De qualquer forma `m'` acaba com uma parceira que ele prefere a `w`, então `w` e `m'` não podem formar um par bloqueador. Logo, o matching retornado não tem nenhum.

**Corolário 25.10.** Dados os rankings de `n` mulheres e `n` homens, Gale-Shapley pode ser implementado para rodar em tempo `O(n²)`.

### Otimalidade: proposer-optimal, e provadamente pior para o outro lado

A escolha livre da linha 2 sobre qual mulher propõe em seguida levanta a questão de se diferentes escolhas produzem matchings estáveis diferentes.

**Teorema 25.11.** Independentemente de como as mulheres livres são escolhidas na linha 2, Gale-Shapley sempre retorna o *mesmo* matching estável — e nele, cada mulher tem o melhor parceiro possível em *qualquer* matching estável para aquela instância.

A prova (por contradição) considera o primeiro momento, ao longo de toda a execução, em que algum homem rejeita uma parceira que pertence a algum outro matching estável `M'`; ela mostra que esse momento não pode de fato acontecer sem forçar um par bloqueador em `M'`, o que faria `M'` não ser estável afinal — então nenhuma mulher pode se sair melhor do que o que Gale-Shapley dá a ela.

**Corolário 25.12.** Podem existir matchings estáveis que Gale-Shapley nunca retorna. No exemplo de Monica/Phoebe/Rachel/Chandler/Joey/Ross acima, três matchings estáveis diferentes existem para os mesmos rankings, mas uma chamada a Gale-Shapley retorna só um deles (o matching 1, onde toda mulher tem sua primeira escolha — consistente com o Teorema 25.11).

**Corolário 25.13.** No matching que Gale-Shapley retorna, cada *homem* tem o pior parceiro possível em qualquer matching estável. Isso decorre do Teorema 25.11: se algum homem `m` preferisse uma parceira `w'` de um matching estável diferente `M'` em vez de sua parceira `w` de Gale-Shapley, então, como `w` é o melhor parceiro possível de `w` em qualquer matching estável, `w` precisaria preferir `m` ao seu parceiro em `M'` — tornando `w` e `m` um par bloqueador em `M'`, contradizendo a estabilidade de `M'`.

### Um parente estruturalmente diferente: o problema dos colegas de quarto estáveis

O CLRS também apresenta o **problema dos colegas de quarto estáveis**: mesma ideia — pares bloqueadores, matching estável — mas num *grafo completo*, não bipartido, com um número par de vértices, cada um ranqueando toda outra pessoa (sem "dois lados"). Para quatro pessoas — Wendy, Xenia, Yolanda e Zelda:

```
Wendy:   Xenia, Yolanda, Zelda
Xenia:   Wendy, Zelda, Yolanda
Yolanda: Wendy, Zelda, Xenia
Zelda:   Xenia, Yolanda, Wendy
```

o matching {Wendy-Xenia, Yolanda-Zelda} é estável. Mas diferente do problema bipartido do casamento estável — onde o Teorema 25.9 garante que um matching estável sempre existe — o texto observa que o problema dos colegas de quarto estáveis pode ter instâncias para as quais **nenhum** matching estável existe.

## Trade-offs

- **Estabilidade não é unicidade** — um dado conjunto de rankings pode admitir vários matchings estáveis distintos (o exemplo de Monica/Phoebe/Rachel/Chandler/Joey/Ross tem três), então "encontre um matching estável" e "encontre o matching estável" são problemas diferentes; Gale-Shapley resolve só o primeiro, retornando deterministicamente um matching estável específico.
- **Proposer-optimal também é non-proposer-pessimal** — o mesmo algoritmo que dá a cada mulher (o lado que propõe) seu melhor parceiro alcançável entre todos os matchings estáveis simultaneamente dá a cada homem (o lado a quem se propõe) seu *pior* parceiro alcançável (Teorema 25.11, Corolário 25.13). Qual lado propõe não é um detalhe de implementação neutro; ele decide a quem o algoritmo favorece.
- **A escolha livre na linha 2 não ameaça o determinismo** — a ordem em que mulheres livres são selecionadas para propor pode variar arbitrariamente, mas o Teorema 25.11 garante que o matching final é idêntico independentemente disso, então as implementações são livres para escolher qualquer ordem conveniente (por exemplo, uma fila de mulheres livres) sem afetar o resultado.
- **A estrutura bipartida é o que garante que uma solução exista** — relaxe isso para o problema dos colegas de quarto estáveis (um grafo completo, todo mundo ranqueando todo mundo, sem dois lados) e o CLRS observa que um matching estável pode simplesmente não existir; a pequena instância de Wendy/Xenia/Yolanda/Zelda acima tem um, mas é um exemplo, não uma garantia para toda instância dessa variante.
- **A versão do livro-texto assume contagens iguais e um parceiro cada** — implantações reais como o National Resident Matching Program precisam do algoritmo modificado para um hospital aceitar `r_h ≥ 1` residentes e para os dois lados terem tamanhos desiguais, conforme o próprio enquadramento do CLRS para esse cenário.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 25.2 "The stable-marriage problem", pp. 716-723](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
