---
version: 1.0
updatedAt: 2026-10-20
title: "Propriedade, Empréstimo e Tipos Lineares"
summary: "Sistemas de tipos subestruturais restringem quantas vezes um valor pode ser usado. Os tipos afins do Rust, mais a regra \"vários leitores ou um escritor\", dão segurança de memória e ausência de data races sem coletor de lixo, e a mesma disciplina (tipos lineares) aparece no Linear Haskell e em linguagens de pesquisa para recursos e protocolos."
---
## Objetivos de Aprendizagem

- Explicar tipos lineares, afins e relevantes como sistemas de tipos que abandonam uma das regras estruturais (enfraquecimento, contração) dos tipos comuns.
- Enunciar as regras de propriedade do Rust e a disciplina de empréstimo "vários leitores ou um escritor", e prever quais programas o borrow checker aceita.
- Ler os erros mais comuns do borrow checker (uso após move, empréstimos conflitantes, uma referência que sobrevive ao seu referente) e dizer qual bug cada um previne.
- Explicar para que serve o `unsafe`, o que o RustBelt provou e como a propriedade se relaciona com a lógica de separação.

## Contexto e Motivação

`computer/c-and-assembly` catalogou os bugs de memória da gerência manual: vazamentos, ponteiros pendentes, double free e estouros de buffer. `software-distributed/programming-languages` mostrou a outra resposta clássica, a gerência automática de memória por contagem de referências ou coleta de lixo por rastreamento, que remove esses bugs ao preço de trabalho em tempo de execução e latência menos previsível. Tanto a Microsoft quanto o projeto Chromium relataram que cerca de 70% das suas vulnerabilidades de segurança graves eram bugs de segurança de memória, e por isso uma terceira resposta importa: um sistema de tipos que prova a segurança de memória em tempo de compilação e não deixa custo em tempo de execução.

Essa terceira resposta se apoia numa peça de lógica dos anos 1980. Na **lógica linear** de Girard, uma hipótese é um recurso que pode ser usado exatamente uma vez, e os **sistemas de tipos subestruturais** correspondentes usam a mesma ideia para valores. O Rust (estável desde 2015) é a primeira linguagem amplamente usada construída em torno dela, e as suas regras de propriedade e empréstimo influenciaram diretrizes de segurança do C++ e os tipos não copiáveis adicionados ao Swift. O capítulo sobre ownership do Rust Book é a introdução padrão; este conceito acrescenta a leitura da teoria de tipos e a prova de que ela é correta.

## Teoria Central

### Regras estruturais e o que abandonar

Um sistema de tipos comum deixa você usar uma variável quantas vezes quiser e ignorá-la se quiser. Em termos de lógica ele tem três **regras estruturais**: *troca* (a ordem das hipóteses não importa), *enfraquecimento* (uma hipótese pode ficar sem uso) e *contração* (uma hipótese pode ser usada mais de uma vez). Sistemas subestruturais abandonam algumas delas:

| Sistema | Abandona | Regra para cada valor | Uso típico |
|---|---|---|---|
| Comum | nada | qualquer número de usos | a maioria das linguagens |
| Afim | contração | no máximo uma vez | moves do Rust |
| Relevante | enfraquecimento | pelo menos uma vez | resultados que devem ser usados |
| Linear | os dois | exatamente uma vez | recursos que precisam ser liberados |

"Usar uma vez" é exatamente o que um recurso com dono precisa: uma alocação no heap, um arquivo, um guarda de lock ou um socket deve ser liberado uma vez e não ser usado depois.

### Propriedade e moves em Rust

As regras do Rust são: todo valor tem exatamente um **dono**; quando o dono sai de escopo o valor é **descartado** (seu destrutor roda e a memória é liberada, como no RAII do C++); e atribuir ou passar um valor **move** a propriedade, depois do que o nome antigo não pode ser usado. Mover é a regra afim: o valor pode ser usado no máximo uma vez como dono. Dados simples como inteiros implementam `Copy`, que permite duplicação (contração) porque não há recurso para liberar duas vezes.

Como existe exatamente um dono a cada instante, existe exatamente um lugar que libera o valor. Isso elimina double free e uso após liberação por construção, e torna a limpeza determinística, sem coletor de lixo.

### Empréstimo e a regra de aliasing

Mover tudo tornaria o código inutilizável, então um valor pode ser **emprestado** por meio de uma referência. Há dois tipos, e o compilador impõe uma regra sobre todas as referências a um lugar em cada ponto do programa: a cada instante ou existe qualquer número de referências compartilhadas `&T` (somente leitura), ou existe exatamente uma referência exclusiva `&mut T`, nunca as duas. Em resumo, **aliasing XOR mutabilidade**.

Essa regra única remove classes inteiras de bugs em tempo de compilação. A invalidação de iterador (mutar uma coleção enquanto se itera) é rejeitada porque o laço mantém um empréstimo compartilhado. Data races (duas threads, uma escrevendo) são rejeitadas porque um valor que cruza threads precisa ser `Send` e o acesso compartilhado precisa ser `Sync`, e vale a mesma regra de aliasing. Uma referência também nunca pode sobreviver aos dados para os quais aponta; o compilador acompanha isso com **lifetimes**, regiões do programa durante as quais uma referência é válida. Desde a edição de 2018, os "lifetimes não lexicais" calculam a extensão de um empréstimo a partir do seu último uso e não do bloco que o envolve, o que aceita mais programas corretos.

### O que ela não previne

Vazamentos de memória são *seguros* no Rust (ciclos de `Rc`, `mem::forget`), então a garantia não é "tudo é liberado". Deadlocks, erros de lógica, panics e a semântica de overflow aritmético estão fora dela. A propriedade dá segurança de memória e ausência de data races, não correção em geral.

### `unsafe` e sua correção

Algumas operações necessárias não podem ser checadas por essas regras (desreferenciar ponteiro cru, chamar código externo, implementar o próprio `Vec`). O Rust deixa o programador marcar uma região como `unsafe` e assumir a responsabilidade de manter as regras dentro dela. Os tipos seguros da biblioteca padrão (`Vec`, `Rc`, `Mutex`) são construídos assim: internos inseguros, interface segura. O projeto RustBelt (Jung et al., POPL 2018) deu à linguagem uma base formal: um cálculo núcleo, com seus tipos interpretados na lógica de separação **Iris**, em que ser dono de um tipo corresponde a ser dono da memória que ele descreve. Para esse cálculo, provou que código seguro bem tipado não pode causar comportamento indefinido, e que a implementação insegura de uma biblioteca é correta se satisfaz o contrato semântico do seu tipo. O conceito sobre lógica de separação desenvolve essa leitura.

### Tipos lineares além da memória

A mesma disciplina controla qualquer recurso com protocolo. O Linear Haskell (GHC 9.0) acrescenta uma seta linear `a %1 -> b` a uma linguagem funcional preguiçosa. Projetos com typestate codificam "um arquivo deve ser aberto, depois lido, depois fechado" de modo que chamar métodos fora de ordem é um erro de tipo. O `try`-with-resources do Java é uma convenção sintática que chama `close()` por você, mas nada impede o código de usar um recurso depois de fechado, e o `std::unique_ptr` do C++ é movível, mas um objeto movido continua utilizável, o que o compilador não proíbe.

## Exemplos Resolvidos

### Exemplo 1: uso após move

**Problema:** Por que o trecho a seguir não compila, e que bug isso previne?

```text
let s = String::from("hi");
let t = s;             // a propriedade do buffer no heap passa para t
println!("{s}");       // error[E0382]: borrow of moved value: `s`
```

**Solução:** `String` é dona de um buffer no heap e não implementa `Copy`, então `let t = s` o move: `s` agora é inválida, e o compilador rejeita o uso. Se `s` e `t` continuassem utilizáveis, as duas seriam descartadas no fim do escopo e liberariam o mesmo buffer. O equivalente em C, `char *q = p; free(p); free(q);`, é um double free que compila em silêncio. Para continuar usando o original, você ou o clona explicitamente (`s.clone()`, um custo visível) ou o empresta (`let t = &s;`).

### Exemplo 2: invalidação de iterador

**Problema:** O que acontece quando um laço muta o vetor que itera?

```text
let mut v = vec![1, 2, 3];
for x in &v {                       // empréstimo compartilhado de v dura o laço todo
    if *x == 2 { v.push(4); }       // error[E0502]: cannot borrow `v` as mutable
}                                   // because it is also borrowed as immutable
```

**Solução:** O laço mantém `&v` durante toda a sua execução, e `push` precisa de `&mut v`. Aliasing XOR mutabilidade faz disso um erro de compilação. `push` pode realocar o buffer, deixando o iterador apontando para memória liberada; em C++ isso é comportamento indefinido, e em Java é detectado tarde, em tempo de execução, como `ConcurrentModificationException`. Em Rust o programa nunca é construído.

### Exemplo 3: uma referência que sobrevive ao seu referente

**Problema:** Explicar o erro e depois explicar o que a anotação de lifetime em `longest` promete.

```text
let r;
{
    let x = 5;
    r = &x;                         // error[E0597]: `x` does not live long enough
}
println!("{r}");

fn longest<'a>(x: &'a str, y: &'a str) -> &'a str { if x.len() > y.len() { x } else { y } }
```

**Solução:** `x` é descartado na chave de fechamento, mas `r` é usado depois, então `r` apontaria para memória de pilha morta; é o ponteiro pendente do C, pego em tempo de compilação. Em `longest`, `'a` diz que a referência devolvida é válida por no máximo o tempo das duas entradas. Um chamador portanto não pode usar o resultado depois que o dono de qualquer dos argumentos tiver sumido. A anotação não muda o comportamento em tempo de execução; é um contrato que o compilador verifica em cada ponto de chamada.

## Equívocos Comuns e Armadilhas

- **"Sem coletor de lixo não há vazamento de memória."** Vazamentos são seguros, e ciclos com contagem de referências (`Rc` com ponteiros de volta) vazam. A propriedade garante que nada é liberado duas vezes nem usado após a liberação, não que tudo é liberado em algum momento.
- **"O borrow checker é uma regra de estilo."** É um sistema de tipos com teorema de correção. Entre os programas que rejeita há alguns corretos numa execução particular mas inseguros em geral, o preço de uma checagem decidível e modular.
- **"Propriedade é só sobre memória."** Ela rastreia qualquer recurso: descritores de arquivo, locks, transações, buffers de GPU. As mesmas regras fazem um guarda de lock liberar o lock exatamente uma vez.
- **"`unsafe` desliga as checagens."** Ele permite algumas operações extras e torna o programador responsável por elas. O borrow checker continua rodando em todo o resto dentro do bloco.

## Resumo

Sistemas de tipos subestruturais abandonam as regras estruturais que deixam valores comuns serem duplicados ou ignorados: tipos afins permitem no máximo um uso, tipos lineares exatamente um. O Rust aplica isso à memória com propriedade única, moves e uma regra de empréstimo de vários leitores ou um escritor, checada com lifetimes em tempo de compilação. O resultado é segurança de memória e ausência de data races com limpeza determinística e sem coletor de lixo, embora vazamentos e erros de lógica continuem possíveis. Abstrações seguras se apoiam em internos `unsafe`, e o RustBelt provou o arranjo todo correto usando lógica de separação. Os próximos conceitos vão do que um sistema de tipos pode garantir ao outro extremo do espectro: tipos ricos o bastante para expressar e provar especificações arbitrárias.

## Documentation Links

- [The Rust Programming Language: Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html): doc
- [Jung, Jourdan, Krebbers, Dreyer: RustBelt: Securing the Foundations of the Rust Programming Language (POPL 2018)](https://plv.mpi-sws.org/rustbelt/popl18/paper.pdf): doc
- [Bernardy et al.: Linear Haskell: Practical Linearity in a Higher-Order Polymorphic Language (POPL 2018)](https://arxiv.org/abs/1710.09756): doc
