---
title: "PRIMES está em P"
summary: Um algoritmo determinístico que decide se um número é primo em tempo polinomial no número de dígitos, sem nenhuma hipótese não provada, construído sobre uma generalização do pequeno teorema de Fermat para polinômios.
researchArea: Algoritmos e teoria
keywords: teste de primalidade, algoritmos determinísticos, complexidade computacional, identidades polinomiais, teoria dos números, desrandomização
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Decidir se um número n é primo é um dos problemas mais antigos da matemática, e importa na prática porque muitos protocolos criptográficos precisam de primos grandes. A divisão por tentativa é correta, mas exige cerca da raiz quadrada de n passos, o que é exponencial no tamanho da entrada (o número de dígitos, log n). Um teste eficiente deveria levar um número de passos polinomial em log n.

Antes deste artigo, as melhores respostas abriam mão de algo. Miller (1975) deu um teste determinístico em tempo polinomial, mas que depende da Hipótese de Riemann Estendida. Rabin, e Solovay e Strassen, deram testes incondicionais em tempo polinomial que são randomizados. Adleman, Pomerance e Rumely (1983) deram um teste determinístico incondicional, mas com tempo de execução (log n) elevado a O(log log log n), um pouco pior que polinomial. A pergunta era se a primalidade está na classe P, e este artigo de Manindra Agrawal, Neeraj Kayal e Nitin Saxena (Annals of Mathematics, 2004) responde que sim.

Vale conhecer antes: aritmética modular, o pequeno teorema de Fermat, a ideia de tempo polinomial no tamanho da entrada e a diferença entre algoritmos randomizados e determinísticos.

## Contribuição

- **Um teste de primalidade incondicional, determinístico e em tempo polinomial.** Sem escolhas aleatórias e sem hipótese não provada.
- **Uma nova caracterização dos primos.** O pequeno teorema de Fermat diz que `a^(n-1) = 1 (mod n)` para n primo, mas alguns compostos (números de Carmichael) passam nele para todo a. O artigo usa a versão polinomial, `(X + a)^n = X^n + a (mod n)`, que vale exatamente quando n é primo, e acha um jeito de testá-la de forma barata.
- **Uma prova elementar.** A prova de correção usa álgebra simples, exceto por um resultado de teoria de crivos que só é necessário para o melhor limite de tempo. Os algoritmos anteriores baseados em certificados tinham provas muito mais complexas.
- **Um tempo de execução de cerca de log^(15/2) n,** com uma melhoria conjecturada para cerca de log^6 n.

## Metodologia

O artigo é teórico e seu método é uma prova. A identidade acima caracteriza os primos, mas verificá-la leva cerca de n passos, porque o lado esquerdo tem n coeficientes. Os autores a reduzem módulo um polinômio `X^r - 1` com r pequeno, de modo que restam só r coeficientes: `(X + a)^n = X^n + a (mod X^r - 1, n)`. Todo primo passa para todo a e r, mas alguns compostos passam para alguns deles. O resultado-chave é que, para um r bem escolhido, passar para um número polinomialmente limitado de valores de a força n a ser uma potência de primo.

O algoritmo tem seis passos: rejeitar potências perfeitas; achar o menor r tal que a ordem de n módulo r seja maior que log^2 n; rejeitar n se ele compartilha fator com algum a até r; responder primo se n não é maior que r; testar a congruência polinomial para a de 1 até cerca da raiz quadrada da função totiente de r vezes log n; caso contrário responder primo. O artigo então prova que existe um r adequado de tamanho no máximo cerca de log^5 n, que o algoritmo responde primo exatamente para os primos e conta o tempo.

## Resultados

Estes são os resultados provados pelos autores.

- **Teorema 4.1.** O algoritmo devolve primo se e somente se n é primo.
- **Teorema 5.1.** O tempo de execução é O~(log^(21/2) n), em que O~ esconde fatores logarítmicos. O laço do passo 5 domina, com cerca de r^2 log^3 n de trabalho.
- **Teorema 5.3.** Usando um resultado de Fouvry sobre a densidade dos primos q para os quais q menos 1 tem um fator primo grande, existe um r adequado de tamanho O(log^3 n), e o tempo cai para O~(log^(15/2) n).
- **Limites conjecturais.** Se a densidade dos primos de Sophie Germain se comportar como conjecturado, r pode ser cerca de log^2 n e o tempo O~(log^6 n). Se uma outra conjectura da literatura (6.1), verificada por outros para r até 100 e n até 10^10, fosse provada, o tempo seria O~(log^3 n).
- O artigo relata que Lenstra e Pomerance obtiveram uma versão modificada com tempo de execução provável de O~(log^6 n).

## Análise crítica

É um resultado marcante, e a prova é curta o bastante para ser lida. Alguns pontos para o leitor atento:

- **Teoria, não engenharia.** O artigo não tem implementação nem medidas de tempo. Um polinômio de grau alto ainda pode ser lento, e em nossa leitura os testes randomizados como o Miller-Rabin continuam sendo os usados na prática porque são muito mais rápidos, com um erro que pode ser tornado desprezível. O valor do artigo é encerrar a questão de complexidade.
- **O melhor limite se apoia em teoria dos números externa ao artigo.** O Teorema 5.3 depende de um resultado de teoria de crivos de outros autores, e os melhores limites dependem de conjecturas que não estavam provadas na época.
- **Diz o que está em P, não como achar primos.** O teste decide a primalidade de um número dado. Ele não produz por si só um primo grande, o que na prática se faz testando candidatos aleatórios.
- **Os próprios autores apontam melhorias,** como um conjunto menor de valores de a que pode bastar, então o limite O~(log^(15/2) n) deve ser lido como um primeiro resultado.

## Pesquisas futuras

- Mostrar que menos valores de a bastam no laço do passo 5, o que os autores consideram muito provável.
- Provar a Conjectura 6.1 e as conjecturas de densidade, o que reduziria o expoente para 3 e 6.
- Implementações práticas e comparação com testes randomizados nos tamanhos de número que a criptografia usa.
- A questão mais ampla de se outros algoritmos randomizados podem ser tornados determinísticos com ideias semelhantes de identidades polinomiais.
