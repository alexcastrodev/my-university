---
title: "Spanner: o banco de dados globalmente distribuído do Google"
summary: O Spanner divide um banco multiversão e semirrelacional em grupos Paxos espalhados por datacenters do mundo todo e usa uma API que expõe a incerteza do relógio, o TrueTime, para dar transações distribuídas externamente consistentes.
researchArea: Sistemas distribuídos
keywords: spanner, truetime, consistência externa, transações distribuídas, paxos, replicação geográfica
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Serviços grandes querem duas coisas que se puxam em direções opostas: um banco de dados que atravesse datacenters em vários continentes e transações que se comportem como se houvesse uma única máquina. Os sistemas anteriores ao Spanner no Google abriam mão de uma delas. O Bigtable escalava, mas era difícil de usar em aplicações com esquemas em evolução ou que precisavam de consistência forte entre réplicas de longa distância, e o Megastore tinha um modelo mais amigável, mas baixa vazão de escrita.

Este artigo do OSDI 2012 descreve o Spanner, o banco que o Google construiu para oferecer as duas coisas. Seu primeiro cliente foi o F1, a reescrita do backend de publicidade que era um banco MySQL particionado manualmente.

Vale conhecer antes: replicação baseada em Paxos (veja o artigo do Raft em Papers para um relato mais gentil), commit em duas fases, controle de concorrência multiversão e o que a linearizabilidade (também chamada de consistência externa) promete: se uma transação termina antes de outra começar, a segunda a enxerga.

## Contribuição

- **Um banco sobre replicação global.** Os dados ficam em tabelas semirrelacionais com esquema, versionados e marcados com o instante do commit, divididos em muitas máquinas de estados Paxos. As aplicações controlam quantas réplicas existem, onde ficam e a que distância estão dos usuários.
- **TrueTime.** Uma API de relógio que devolve não um horário, mas um intervalo, `[earliest, latest]`, com a garantia de conter o tempo real. Ela é construída com receptores GPS e relógios atômicos em cada datacenter.
- **Consistência externa em escala global.** Com o TrueTime, cada transação recebe um timestamp de commit que reflete a ordem em que as transações realmente aconteceram, o que permite backups consistentes, mudanças atômicas de esquema e transações somente de leitura sem lock.
- **Reparticionamento e migração** de dados entre máquinas e datacenters, feitos automaticamente.

## Metodologia

A ideia central é a regra de commit wait. O líder coordenador de uma escrita escolhe um timestamp de commit não menor que `TT.now().latest` e então segura o resultado até que `TT.after` desse timestamp seja verdadeiro, ou seja, até haver certeza de que ele está no passado. Como uma transação posterior começa depois que o timestamp da anterior já passou, o timestamp dela precisa ser maior. O artigo traz uma prova curta dessa ordenação.

Transações somente de leitura e leituras em um timestamp não tomam locks. Cada réplica acompanha um safe time até o qual está atualizada e pode atender qualquer leitura nesse valor ou abaixo dele.

O próprio TrueTime vem de um conjunto de time masters por datacenter, a maioria com receptores GPS e alguns com relógios atômicos (para que os dois tipos de falha não sejam correlacionados), e de um daemon em cada máquina que os consulta e alarga sua incerteza entre as consultas. A avaliação usa microbenchmarks em um universo de teste, experimentos de disponibilidade em que zonas inteiras são derrubadas, medições do TrueTime em máquinas de produção e o caso do F1.

## Resultados

Estes são os resultados relatados pelos autores.

- Em uma configuração com uma réplica, o commit wait leva cerca de 5 ms e o Paxos cerca de 9 ms. A latência se mantém praticamente constante ao acrescentar réplicas, porque o Paxos roda em paralelo entre elas.
- O commit em duas fases com muitos participantes escala: a latência média e a do percentil 99 são aceitáveis até 50 participantes e começam a subir de forma perceptível em 100.
- Derrubar uma zona sem líderes não afeta a vazão de leitura. Derrubar a zona dos líderes com aviso custa de 3 a 4%, e sem aviso a vazão cai para quase zero e se recupera em cerca de 10 segundos, a duração do lease de líder do Paxos.
- A incerteza ε do TrueTime segue um dente de serra entre 0 e 6 ms entre consultas, mais cerca de 1 ms de atraso de comunicação. Os autores relatam que CPUs defeituosas são 6 vezes mais prováveis que relógios defeituosos em suas máquinas, e que o ε teve um pico quando dois time masters foram desligados para manutenção.
- O F1 saiu de um MySQL particionado manualmente, cujo último reparticionamento havia exigido mais de dois anos de esforço, e ganhou replicação síncrona, failover automático e transações sobre todos os seus dados.

## Análise crítica

O Spanner é um artigo de sistemas importante porque mostra como tornar explícita uma suposição fraca (relógios são incertos) e construir garantias fortes sobre ela. Alguns limites merecem atenção.

- **Dependência de infraestrutura especial.** A garantia vale enquanto o relógio real ficar dentro do intervalo. O artigo afirma que uma deriva de relógio acima de 200 µs por segundo quebraria as suposições do TrueTime, e ele depende de hardware de GPS e relógios atômicos que muitas implantações não têm.
- **A latência é paga no commit.** O commit wait cresce com o ε. Os autores esperam que a maioria das aplicações replique entre datacenters próximos e acham possível um ε abaixo de 1 ms, mas isso é uma projeção.
- **Um sistema jovem, com um usuário principal.** A avaliação é dominada pelo F1 e por microbenchmarks com máquinas a menos de 1 ms de distância. Índices secundários automáticos, reparticionamento por carga e uma linguagem de esquema completa ainda estavam em andamento, e os detalhes do TrueTime ficam para outro artigo.
- **Sem comparação direta.** Os trabalhos relacionados são discutidos em palavras. Os resultados vêm do sistema e da carga dos próprios autores.
- **SQL complexo era um ponto fraco.** O próprio artigo diz que as estruturas de dados locais ao nó foram projetadas para acesso chave-valor e têm desempenho ruim em consultas complexas.

## Pesquisas futuras

- Formas mais baratas ou só em software de limitar a incerteza do relógio, para que o projeto possa ser usado fora dos datacenters do Google.
- Reduzir o ε e o custo do commit wait, e medir o efeito em cargas de transações majoritariamente curtas.
- Leituras paralelas otimistas, que segundo os autores exigem uma implementação nada trivial, e reconfiguração direta dos grupos Paxos.
- Melhor execução de consultas em um único nó, aproveitando a literatura de bancos de dados.
- Movimentação automática de dados (e, mais difícil, de processos da aplicação) entre datacenters conforme a carga muda.
