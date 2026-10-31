---
title: "The Demikernel Datapath OS Architecture for Microsecond-scale Datacenter Systems"
summary: Um sistema operacional de caminho de dados portável para dispositivos kernel-bypass, que dá a aplicações em escala de microssegundos uma única API e custos em escala de nanossegundos.
researchArea: Sistemas operacionais
keywords: sistema operacional, bypass de kernel, datacenters, libos
version: 1.1
updatedAt: 2026-10-31
---

## Visão geral

Redes, discos e sistemas em memória de data centers hoje respondem em poucos microssegundos, então o sistema operacional no caminho de E/S precisa custar nanossegundos. Dispositivos kernel-bypass tiram o kernel do caminho de dados, mas deixam as aplicações sem os serviços de sistema operacional que antes recebiam: pilhas de rede e de armazenamento, gerenciamento de memória e escalonamento de CPU.

Este artigo do SOSP 2021, da Microsoft Research e de várias universidades, propõe o Demikernel, um sistema operacional e uma arquitetura de caminho de dados para essa lacuna.

## Contribuição

O Demikernel define três coisas.

- **Novos recursos de SO de caminho de dados** para aplicações em escala de microssegundos: coordenação de memória zero-copy entre a aplicação e o dispositivo, um heap compatível com DMA e proteção contra use-after-free.
- **PDPIX**, uma API de caminho de dados portável construída em torno de filas de E/S e conclusões assíncronas (descritores de fila e qtokens), no lugar de arquivos e sockets com chamadas bloqueantes.
- **Uma arquitetura de library OS**, com libOSes intercambiáveis que rodam ao lado de um kernel legado usado só para o caminho de controle, cada um delegando ao seu dispositivo quando pode e implementando o resto numa biblioteca em espaço de usuário.

## Metodologia

Os autores construíram dois protótipos de sistemas operacionais de caminho de dados, para Linux e Windows, com libOSes para RDMA, DPDK, SPDK e POSIX (os nomes dos libOSes incluem Catnap, Catmint, Catnip e Cattree). A implementação é em grande parte em Rust. Inclui uma pilha TCP zero-copy projetada para custos em escala de nanossegundos, um alocador de memória ciente de dispositivos kernel-bypass e um escalonamento baseado em corrotinas do processamento de E/S e do trabalho da aplicação numa única thread.

A avaliação porta sistemas e aplicações existentes em escala de microssegundos para o PDPIX e mede o custo em comparação com usar diretamente as APIs de kernel-bypass.

## Resultados

Estes são os resultados relatados pelos autores.

- Aplicações portadas para o Demikernel rodam em diferentes dispositivos kernel-bypass sem mudanças de código.
- O caminho de dados acrescenta cerca de 50 ns de latência de processamento de E/S por E/S.
- A sobrecarga na vazão de pico é de 17 a 26% em comparação com usar diretamente as APIs de kernel-bypass.
- Os autores relatam que construir e portar aplicações deu pouco trabalho.

## Análise crítica

O Demikernel é uma resposta convincente a uma lacuna real, e o artigo é aberto sobre seu escopo.

Pontos para ler com cuidado:

- A API comum esconde recursos específicos de cada dispositivo, então não serve para cargas que precisam deles diretamente, como RDMA de um lado só, computação de alto desempenho ou middleboxes em software. Os próprios autores dizem isso.
- O escalonamento é cooperativo, então as aplicações precisam rodar num laço de E/S curto e entrar no libOS pelo menos uma vez a cada milissegundo. Deixar de dar ciclos ao SO de caminho de dados pode causar pacotes descartados e confirmações que não são enviadas.
- Zero-copy e a proteção contra use-after-free dependem do alocador de memória do Demikernel, que os autores apresentam como um custo para aplicações que querem usar o seu próprio.
- A sobrecarga de 17 a 26% na vazão é o preço da portabilidade, e a medida do artigo depende de quais aplicações e dispositivos foram testados.

## Pesquisas futuras

- Escalonamento que equilibre o processamento de E/S e o trabalho da aplicação quando as requisições são longas ou muito variadas.
- Suportar mais recursos de dispositivo pela API comum sem perder portabilidade.
- Escala em vários núcleos: os libOSes têm uma única thread e os autores dizem que ainda não sabem se evitar estado compartilhado entre núcleos será uma limitação importante.
