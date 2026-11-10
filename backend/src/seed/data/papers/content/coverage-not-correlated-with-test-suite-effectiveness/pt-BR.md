---
title: "Cobertura não tem forte correlação com a efetividade de uma suíte de testes"
summary: Um estudo grande, com cinco programas Java e 31.000 suítes de teste, conclui que, controlado o número de testes, a cobertura de código tem apenas correlação de baixa a moderada com a quantidade de falhas injetadas que uma suíte detecta.
researchArea: Engenharia de software
keywords: cobertura de código, efetividade de suítes de teste, teste de mutação, engenharia de software empírica, testes unitários, java
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Muitas equipes definem uma meta de cobertura, como "80% das linhas", com o raciocínio de que uma suíte de testes não consegue achar um bug em código que nunca executa. Esse raciocínio é verdadeiro até certo ponto. A pergunta deste artigo é se a cobertura também é uma boa medida de quantos bugs uma suíte vai pegar, de modo que aumentá-la seja uma boa forma de melhorar uma suíte.

Estudos anteriores discordavam. Vários não controlavam o tamanho da suíte, embora a cobertura suba quando testes são acrescentados. A maioria usava programas pequenos ou sintéticos, e muitos comparavam apenas suítes "adequadas" a um critério de cobertura, que são raras na prática. Este artigo do ICSE 2014, da Universidade de Waterloo, trata essas três lacunas com o que os autores chamam de o maior estudo do tipo até então.

Vale conhecer antes: cobertura de instruções, de decisões e de condições modificadas, o que é teste de mutação (pequenas mudanças injetadas no código, verificando depois se os testes percebem) e o que uma correlação de postos mede.

## Contribuição

- **Um grande estudo empírico** que relaciona o tamanho da suíte, três tipos de cobertura (instruções, decisões e condições modificadas) e a efetividade em cinco sistemas Java de código aberto com até 724.000 linhas.
- **Controle do tamanho da suíte.** O estudo separa o efeito da cobertura do efeito de simplesmente ter mais testes.
- **Suítes realistas.** As suítes são subconjuntos aleatórios da suíte de testes de cada projeto, e não apenas as adequadas.
- Uma recomendação prática: usar a cobertura para achar código pouco testado, mas não como meta de qualidade.

## Metodologia

Os sujeitos são Apache POI, Closure Compiler, HSQLDB, JFreeChart e Joda Time, escolhidos por tamanho (na ordem de 100.000 linhas), atividade, grande número de testes JUnit e build com Ant. Para cada um, os autores geraram 1.000 suítes de teste aleatórias para cada um de vários tamanhos, 31.000 no total, como subconjuntos estritos da suíte do próprio projeto.

A efetividade é a fração de mutantes que uma suíte mata, com a ferramenta de teste de mutação PIT, e também é normalizada pelo número de mutantes que a suíte cobre. Mutantes que a suíte inteira não conseguiu matar são considerados equivalentes e removidos. Os autores calculam a correlação de postos τ de Kendall entre tamanho, cobertura e efetividade, em três situações: só o tamanho, cobertura com o tamanho ignorado e cobertura com o tamanho mantido constante.

## Resultados

Estes são os resultados relatados pelos autores.

- A efetividade tem correlação de moderada a muito alta com o número de métodos de teste de uma suíte.
- Quando o tamanho é ignorado, cobertura e efetividade têm correlação de moderada a alta na maioria dos programas. A exceção é o HSQLDB, em que suítes com mais cobertura matam menos mutantes para cada unidade de código coberta.
- Quando o número de testes é mantido constante, a correlação entre cobertura e efetividade é em geral de baixa a moderada e varia de sistema para sistema.
- A cobertura de decisões e a de condições modificadas não deram um sinal mais forte que a de instruções.
- Os autores concluem que a cobertura é útil para achar partes pouco testadas de um programa, mas que um valor fixo de cobertura dificilmente produz uma suíte efetiva, e que o custo de formas mais fortes de cobertura pode não se justificar.

## Análise crítica

O artigo virou referência padrão contra metas de cobertura. É mais forte como alerta do que como prova, e os autores discutem eles mesmos os limites.

- **A efetividade é um substituto.** Matar mutantes injetados representa pegar falhas reais. Trabalhos anteriores citados pelos autores sustentam essa ligação, mas ela continua sendo uma suposição, e importante.
- **Mutantes equivalentes.** Até 35% dos mutantes foram declarados equivalentes porque a suíte completa não conseguiu matá-los. Se os desenvolvedores testam certos tipos de falha com mais frequência, esse filtro pode enviesar o resultado.
- **Suítes aleatórias não são como as pessoas montam suítes.** Subconjuntos escolhidos ao acaso de uma suíte escrita por desenvolvedores podem se comportar de modo diferente de suítes que as pessoas fazem crescer de propósito, e o estudo não pode dizer se aumentar a cobertura em uma equipe que a acompanha ajuda na prática.
- **Correlação, não causalidade.** Os autores afirmam que nada aqui mostra a direção da causalidade.
- **Cinco sistemas, todos em Java.** A força da relação varia entre os cinco sujeitos, o que os próprios autores tratam como motivo para não generalizar.

## Pesquisas futuras

- Repetir o estudo com falhas reais e com suítes que desenvolvedores escreveram sob uma meta de cobertura.
- Outras medidas de qualidade de testes, como o quanto as asserções verificam o comportamento, e combinações dessas medidas com a cobertura.
- Replicação em outras linguagens, tipos de software e estilos de teste.
- Estudos sobre o que as metas de cobertura fazem com a maneira como as equipes escrevem testes.
