---
title: "RustBelt: assegurando as fundações da linguagem Rust"
summary: A primeira prova de segurança verificada por máquina para um subconjunto realista do Rust, construída para que cada biblioteca que usa código unsafe receba uma condição precisa a cumprir para ser considerada uma extensão correta da linguagem.
researchArea: Linguagens de programação
keywords: rust, segurança de memória, ownership, lógica de separação, corretude de tipos, código unsafe
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

O Rust promete o controle de baixo nível do C++ com a segurança de memória e de threads de uma linguagem de alto nível, e faz isso com um sistema de tipos baseado em ownership que elimina data races e use-after-free em tempo de compilação. A promessa era amplamente aceita, mas não provada. A dificuldade é que a parte segura do Rust não é autossuficiente: bibliotecas padrão como `Rc`, `RefCell` e `Mutex` são escritas com código `unsafe` por dentro, e o sistema de tipos trata suas interfaces como seguras. De fato, já haviam sido encontrados bugs de corretude, no sistema de tipos e em bibliotecas.

Este artigo do POPL 2018, de pesquisadores do MPI-SWS e de Delft, dá uma descrição formal e verificada por máquina de como essas peças se encaixam e do que é preciso para que uma biblioteca com internos unsafe seja segura de usar.

Vale conhecer antes: ownership e empréstimos (borrowing) do Rust, incluindo lifetimes, o que o `unsafe` permite, a ideia de corretude de tipos (programas bem tipados não "dão errado") e uma noção geral do que é uma lógica de programas como a lógica de separação.

## Contribuição

- **λRust**, uma linguagem núcleo de projeto dos autores, em estilo de passagem de continuação, que formaliza os recursos centrais do Rust: ownership, borrowing, lifetimes e inclusão de lifetimes, inspirada na representação intermediária do compilador (MIR).
- **Uma prova semântica de corretude.** Os tipos são interpretados como predicados em uma lógica de programas (uma relação lógica), em vez do método sintático usual de "progresso e preservação", que não funciona quando código seguro e unsafe se misturam.
- **Uma condição de verificação para código unsafe.** Para qualquer biblioteca, o significado semântico de sua interface diz exatamente o que a implementação unsafe precisa provar. Isso torna o resultado extensível.
- **Uma lógica de lifetimes** para raciocinar sobre empréstimos, construída sobre o framework Iris.
- **Bibliotecas verificadas.** Provas, no assistente de provas Coq, para versões em λRust de `Arc`, `Rc`, `Cell`, `RefCell`, `Mutex`, `RwLock`, `mem::swap`, `thread::spawn`, `rayon::join` e `take_mut`.

## Metodologia

A prova tem três partes. Primeiro, mostra-se que as regras de tipagem do λRust são corretas quando lidas semanticamente (o teorema fundamental das relações lógicas). Segundo, um resultado de adequação: um programa fechado que é semanticamente bem tipado não tem comportamento indefinido. Terceiro, para cada biblioteca com código unsafe, uma prova de que sua implementação satisfaz o predicado que a interface lhe dá.

Para modelar o borrowing, os autores definem uma lógica de lifetimes que sustenta a ideia de que um lifetime pode terminar e devolver o ownership, e uma nova forma de provar inclusão de lifetimes para lifetimes ainda não sabidamente ativos, que eles consideraram necessária para tipos como `RefCell` e `RwLock`. Tudo isso é formalizado e verificado no Coq.

## Resultados

Estes são os resultados relatados pelos autores.

- A prova de segurança vale para o λRust e se estende às bibliotecas verificadas sem alterar a prova do núcleo.
- O trabalho de verificação descobriu, e levou à correção de, um bug de corretude antes desconhecido na biblioteca padrão do Rust (o artigo remete a um relatório separado para os detalhes). O modelo também trata funções corretas por razões sutis, como `Ref::map`, cuja assinatura teve de mudar em relação ao projeto inicial para ser correta. Os autores tomam isso como evidência de que o modelo é realista o bastante para ser útil.
- O sistema de tipos já cobre recursos que o próprio Rust ainda estava esboçando, como lifetimes não lexicais.

## Análise crítica

O artigo é um marco e também é honesto sobre o que deixa de fora. Ler esses limites faz parte de usar o resultado.

- **Um subconjunto do Rust.** O λRust omite traits, suporte adequado a funções polimórficas em tipos e tipos sem tamanho estático. Uma prova sobre um modelo vale tanto quanto o encaixe entre o modelo e o compilador real, e o Rust não tem uma semântica formal oficial com a qual medir esse encaixe.
- **Concorrência simplificada.** O modelo de memória tem apenas operações não atômicas e atômicas sequencialmente consistentes. Os atômicos relaxados que bibliotecas como `Arc` usam na prática não são modelados. O mesmo vale para trait objects e para o desempilhamento em caso de panic.
- **Custo do método.** Cada nova biblioteca unsafe precisa de sua própria prova por especialistas em um assistente de provas, então a abordagem não escala sozinha para todo o ecossistema, e é uma ferramenta para quem escreve bibliotecas e não para quem programa em Rust no dia a dia.
- **O que se prova é segurança, não corretude.** Um `Mutex` verificado é seguro de usar; a prova não diz que os programas construídos sobre ele estão livres de deadlocks ou de erros de lógica.
- **Destruição.** As provas cobrem os destrutores das bibliotecas verificadas, mas não a destruição automática, que já havia causado problemas.

## Pesquisas futuras

- Modelar memória relaxada, trait objects e panics, e aproximar o λRust do MIR.
- Verificar mais da biblioteca padrão e de crates populares, com apoio de ferramentas que reduzam o esforço de prova.
- Verificação automatizada de que um bloco unsafe cumpre sua condição de verificação.
- Usar o mesmo estilo de provas semânticas de segurança em outras linguagens que misturam código seguro e unsafe.
