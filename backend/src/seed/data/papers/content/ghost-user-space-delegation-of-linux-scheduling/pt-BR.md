---
title: "ghOSt: delegação rápida e flexível do escalonamento do Linux ao espaço do usuário"
summary: Uma forma de rodar a política de escalonamento do Linux em agentes em espaço de usuário enquanto o kernel só executa as decisões, de modo que as políticas mudem sem reiniciar o host.
researchArea: Sistemas operacionais
keywords: escalonamento, kernel do linux, delegação ao espaço do usuário, latência de cauda, datacenter
version: 1.2
updatedAt: 2026-10-31
---

## Resumo

Apresentamos o ghOSt, nossa infraestrutura para delegar decisões de escalonamento do kernel a código no espaço do usuário. O ghOSt foi projetado para atender às necessidades, em rápida evolução, das cargas de trabalho e das plataformas dos nossos data centers. Melhorar as decisões de escalonamento pode aumentar drasticamente a vazão, a latência de cauda, a escalabilidade e a segurança de cargas de trabalho importantes. No entanto, escalonadores de kernel são difíceis de implementar, testar e implantar de forma eficiente em uma frota grande. Pesquisas recentes sugerem que políticas de escalonamento sob medida, dentro de sistemas operacionais de plano de dados personalizados, podem trazer resultados de desempenho atraentes em um data center. Porém, esses ganhos se mostraram difíceis de obter, pois é impraticável implantar imagens de SO personalizadas na granularidade de uma aplicação, em especial em um ambiente multilocatário, o que limita as aplicações práticas dessas novas técnicas. O ghOSt oferece delegação de uso geral de políticas de escalonamento a processos no espaço do usuário em um ambiente Linux. O ghOSt fornece mecanismos de encapsulamento de estado, comunicação e ação que permitem expressar políticas de escalonamento complexas dentro de um agente no espaço do usuário, ajudando também na sincronização. Programadores usam qualquer linguagem para desenvolver e otimizar as políticas, que são modificadas sem reiniciar o host. O ghOSt suporta uma ampla gama de modelos de escalonamento, de um por CPU a centralizado, de execução até o fim a preemptivo, e tem baixo custo nas ações de escalonamento. Demonstramos o desempenho do ghOSt em cargas de trabalho acadêmicas e reais, incluindo o Google Snap e o Google Search. Mostramos que, usando o ghOSt no lugar do escalonador do kernel, conseguimos rapidamente obter vazão e latência comparáveis, ao mesmo tempo em que habilitamos otimização de políticas, atualizações sem interrupção e isolamento de falhas para as cargas de trabalho dos nossos data centers. Disponibilizamos nossa implementação como código aberto para possibilitar pesquisa e desenvolvimento futuros baseados no ghOSt.

## Visão geral

Onde as threads rodam, e por quanto tempo, afeta muito a vazão, a latência de cauda e a segurança de cargas de data centers. Mesmo assim, escalonadores de kernel são difíceis de mudar: são difíceis de implementar, testar e distribuir numa frota grande.

Este artigo do SOSP 2021, do Google, apresenta o ghOSt, uma infraestrutura que delega as decisões de escalonamento do kernel a código que roda em espaço de usuário no Linux.

## Contribuição

A contribuição do ghOSt é um mecanismo de delegação de propósito geral, não uma nova política de escalonamento.

- As políticas vivem em agentes em espaço de usuário, escritos em qualquer linguagem e atualizados sem reiniciar o host.
- O kernel fornece **encapsulamento de estado** (o que o agente precisa saber), mecanismos de **comunicação** e de **ação**, e ajuda na sincronização entre o kernel e o agente.
- Suporta uma ampla gama de modelos, de por CPU a centralizado e de execução até o fim a preemptivo.
- A intenção é tornar práticas as políticas de escalonamento sob medida que pesquisas recentes construíram dentro de sistemas operacionais de plano de dados personalizados, difíceis de implantar por aplicação num ambiente multi-inquilino.

## Metodologia

O projeto acrescenta ao kernel do Linux uma classe de escalonamento ghOSt. As threads gerenciadas pelo ghOSt são escalonadas conforme decisões que agentes em espaço de usuário devolvem, e os agentes recebem do kernel o estado de que precisam. O repositório público descreve as decisões sendo executadas como transações e inclui políticas de exemplo, como FIFO centralizado e por CPU, uma política parecida com o CFS e uma no estilo Shinjuku.

Os autores avaliam o ghOSt em cargas acadêmicas e em cargas reais, incluindo o Google Snap e o Google Search, comparando-o com o escalonador do kernel.

## Resultados

Estes são os resultados relatados pelos autores, como declarado no resumo.

- Usando o ghOSt no lugar do escalonador do kernel, os autores chegam rapidamente a vazão e latência comparáveis.
- Além disso, ele permite otimização de políticas, atualizações sem interrupção e isolamento de falhas para as cargas dos seus data centers.
- O ghOSt tem baixo custo para as ações de escalonamento nos modelos de escalonamento suportados.
- A implementação é de código aberto.

Esta análise se baseia no resumo e na documentação pública do projeto. Para números de cargas específicas, consulte o artigo.

## Análise crítica

A ideia responde a um problema real de implantação, e a liberação em código aberto permite experimentá-la.

Pontos para ler com cuidado:

- "Comparável" é a manchete: a proposta é flexibilidade e operabilidade mais do que velocidade, então o valor depende de quanto uma política sob medida rende para a sua carga.
- Tirar as decisões do kernel acrescenta uma etapa de comunicação entre o kernel e o agente. Veja no artigo quanto os modelos centralizado e por CPU custam em CPU e latência.
- O resumo promete isolamento de falhas. Veja no artigo o que acontece com as threads quando um agente trava ou fica para trás.
- Exige um kernel Linux modificado, o que limita a adoção fora de operadores que mantêm seus próprios kernels.

## Pesquisas futuras

- Levar a interface de delegação para o Linux principal, ou um equivalente que não exija um fork.
- Políticas que usem melhor o conhecimento da aplicação, como tipos de requisição ou prazos, e como expressá-las com segurança.
- Verificar políticas em espaço de usuário, já que uma política ruim pode deixar threads sem execução.
- Combinar escalonamento delegado com outros sistemas de caminho de dados em espaço de usuário (veja Snap e Demikernel).
