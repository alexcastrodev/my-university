---
title: "Algoritmos de tempo polinomial para fatoração em primos e logaritmos discretos em um computador quântico"
summary: Shor mostra que um computador quântico poderia fatorar inteiros e calcular logaritmos discretos em tempo polinomial no número de dígitos, problemas que nenhum algoritmo clássico conhecido resolve de forma eficiente e nos quais a criptografia de chave pública se apoia.
researchArea: Computação quântica
keywords: algoritmos quânticos, fatoração de inteiros, logaritmo discreto, transformada de Fourier quântica, busca de ordem, criptografia de chave pública
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

A ciência da computação se apoia na crença de que todo dispositivo de computação razoável pode ser simulado por uma máquina de Turing com, no máximo, uma lentidão polinomial. Este artigo, de Peter Shor (então na AT&T), pergunta se isso ainda vale quando as leis da mecânica quântica são levadas em conta. A resposta dele, para dois problemas famosos, é que talvez não.

Os problemas são fatorar inteiros e calcular logaritmos discretos. Não se conhece algoritmo clássico de tempo polinomial para nenhum deles, e a segurança de criptossistemas como o RSA se apoia nisso. O melhor algoritmo clássico de fatoração da época, o crivo de corpos numéricos, leva um tempo que cresce mais rápido que qualquer polinômio no número de dígitos. O artigo mostra algoritmos randomizados eficientes para os dois problemas em um computador quântico hipotético. Ele apareceu primeiro no FOCS 1994 e, de forma revisada, no SIAM Journal on Computing em 1997, e esta análise segue o texto revisado.

Vale conhecer antes: a classe P e a ideia de tempo polinomial, aritmética modular, a transformada de Fourier e o básico de estados quânticos (superposição, medição, operações unitárias).

## Contribuição

- **Algoritmos quânticos de tempo polinomial,** com pequena probabilidade de erro, para fatoração e para logaritmos discretos. Na fatoração, o número de passos quânticos é O((log n)^2 (log log n)(log log log n)), mais um pós-processamento clássico polinomial.
- **Redução à busca de ordem.** Em vez de fatorar diretamente, o algoritmo encontra a ordem r de um x aleatório módulo n, o menor r com x^r = 1 (mod n), e uma redução clássica transforma isso em um fator.
- **Uma transformada de Fourier quântica eficiente** sobre uma quantidade enorme de valores, construída com um número de portas polinomial no número de bits, que é o que torna o ganho possível.
- **Uma discussão franca dos obstáculos físicos,** precisão e decoerência, e do que o algoritmo sugere e não sugere sobre o poder dos computadores quânticos.

## Metodologia

O artigo é teórico e trabalha com o modelo de arranjo de portas quânticas. Para achar a ordem de x módulo n, o algoritmo escolhe uma potência de dois q com n^2 <= q < 2n^2 e monta uma superposição uniforme sobre todos os números a abaixo de q. Em seguida calcula x^a mod n em um segundo registrador de forma reversível, aplica a transformada de Fourier quântica ao primeiro registrador e o mede.

A medição dá um valor c tal que c/q está, com boa probabilidade, perto de uma fração d/r cujo denominador é a ordem r desconhecida. Uma expansão em fração contínua recupera a fração. O artigo mostra que cada resultado útil tem probabilidade de pelo menos 1/(3r^2), de modo que r é recuperado com probabilidade de pelo menos cerca de phi(r)/(3r), e repetir cerca de log log r vezes torna o sucesso provável. Um passo clássico calcula o mdc de x^(r/2) - 1 e n, o que dá um fator não trivial com probabilidade de pelo menos 1 - 1/2^(k-1) quando n tem k fatores primos ímpares distintos. O algoritmo do logaritmo discreto segue o mesmo padrão: uma superposição sobre dois expoentes a e b, o valor g^a x^(-b) mod p em um terceiro registrador e uma transformada de Fourier sobre os dois expoentes.

## Resultados

Estes são os resultados relatados pelo autor.

- Os resultados principais são teoremas de complexidade, não experimentos: fatoração e logaritmos discretos podem ser resolvidos em tempo polinomial em um computador quântico, com probabilidade de erro que pode ser reduzida por repetição.
- A parte quântica do trabalho para fatorar é da ordem de (log n)^2 passos, a menos de fatores pequenos, contra o melhor clássico de exp(c (log n)^(1/3) (log log n)^(2/3)) do crivo de corpos numéricos.
- A imprecisão não precisa ser extrema: citando trabalho anterior de Bennett e coautores, o artigo observa que as portas quânticas só precisam de precisão da ordem de 1 sobre o número de passos t, e que a decoerência precisa ser apenas polinomialmente pequena em t.
- Uma consequência que o autor ressalta: qualquer método geral que simulasse a mecânica quântica de forma clássica com apenas uma lentidão polinomial daria um algoritmo de tempo polinomial para fatorar.

## Análise crítica

Este artigo mudou a área. Ele também tem limites claros, que o autor declara.

- **Não existia computador quântico.** A introdução diz que ninguém sabe como construir um. O resultado é uma afirmação sobre um modelo, e o que ele significa para máquinas reais depende de engenharia.
- **A questão do erro estava em aberto.** O artigo nota que a redundância clássica é descartada para qubits pelo teorema da não clonagem, e só menciona um progresso inicial rumo à correção de erros. Em nossa leitura, o desenvolvimento posterior de códigos de correção de erros quânticos e de tolerância a falhas é o que fez o resultado ser mais que um modelo.
- **O escopo é estreito.** O autor aponta que fatoração e logaritmos discretos só importam por causa da criptografia de chave pública, e que computadores quânticos podem continuar como uma ferramenta de propósito especial a menos que se achem outros problemas. Ele sugere vetores curtos em reticulados como candidato e acha improvável que computadores quânticos resolvam problemas NP-completos, embora não o descarte.
- **Uma vantagem não está provada.** O artigo mostra um algoritmo quântico eficiente. Que fatorar seja difícil para computadores clássicos é uma crença, não um teorema, então, a rigor, o resultado não prova que computadores quânticos são mais poderosos que os clássicos.

## Pesquisas futuras

- Construir computadores quânticos com precisão suficiente, decoerência baixa e correção de erros para rodar computações longas, os obstáculos que o autor lista.
- Achar outros problemas com ganhos exponenciais ou grandes em computadores quânticos, inclusive o problema de reticulados que o autor sugere.
- Estudar se computadores quânticos podem resolver problemas NP-completos, o que o autor não descarta.
- Criptografia que não dependa de fatoração nem de logaritmos discretos, uma direção que decorre do resultado.
